// extension.ts
import * as vscode from 'vscode';
import { globalSymbolIndex } from './symbol-index';
import { extractPythonBlocksWithLineInfo, parsePythonBlockForSymbols } from './symbol-extractor';

/**
 * 判断当前位置是否在 python: 或 init python: 块中
 */
function isInPythonBlock(document: vscode.TextDocument, position: vscode.Position): boolean {
    const blocks = extractPythonBlocksWithLineInfo(document.getText());
    const curLine = position.line;

    for (const block of blocks) {
        const codeLines = block.code.split('\n');
        if (codeLines.length === 0) {continue;}

        const startLine = block.startLine;
        const endLine = startLine + codeLines.length - 1;

        if (curLine >= startLine && curLine <= endLine) {
            return true;
        }
    }
    return false;
}

function updateSymbolIndex(document: vscode.TextDocument) {
    if (document.languageId !== 'renpy') return;

    globalSymbolIndex.clearForDocument(document.uri);

    const blocks = extractPythonBlocksWithLineInfo(document.getText());
    for (const block of blocks) {
        const symbols = parsePythonBlockForSymbols(block.code, block.startLine);
        for (const sym of symbols) {
            globalSymbolIndex.addSymbol(document.uri, sym);
        }
    }
}

async function indexRpyFileFromDisk(uri: vscode.Uri) {
    try {
        const content = await vscode.workspace.fs.readFile(uri);
        const text = new TextDecoder('utf-8').decode(content);

        globalSymbolIndex.clearForDocument(uri);

        const blocks = extractPythonBlocksWithLineInfo(text);
        for (const block of blocks) {
            const symbols = parsePythonBlockForSymbols(block.code, block.startLine);
            for (const sym of symbols) {
                globalSymbolIndex.addSymbol(uri, sym);
            }
        }
    } catch (e) {
        console.warn(`Failed to index ${uri.fsPath}:`, e);
    }
}
// 清理索引
async function rebuildIndex(context: vscode.ExtensionContext) {
    // 1. 清空全局索引
    globalSymbolIndex.clearAll();

    let indexedCount = 0;

    // 2. 索引所有已打开的 renpy 文档
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.languageId === 'renpy') {
            updateSymbolIndex(doc);
            indexedCount++;
        }
    }

    // 3. 索引所有未打开的 .rpy 文件
    if (vscode.workspace.workspaceFolders) {
        const openUris = new Set(vscode.workspace.textDocuments.map(doc => doc.uri.toString()));
        const rpyFiles = await vscode.workspace.findFiles('**/*.rpy');
        for (const uri of rpyFiles) {
            if (!openUris.has(uri.toString())) {
                await indexRpyFileFromDisk(uri);
                indexedCount++;
            }
        }
    }

    // 4. 提示完成
    vscode.window.showInformationMessage(`Ren'Py symbol index rebuilt (${indexedCount} files).`);
}
export async function activate(context: vscode.ExtensionContext) {
    // 1. Hover Provider
    const hoverProvider = vscode.languages.registerHoverProvider('renpy', {
        async provideHover(document, position, token) {
        if (!isInPythonBlock(document, position)) {return null;}

        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {return null;}

        const name = document.getText(wordRange);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {return null;}

        const symbolEntry = globalSymbolIndex.getSymbol(name);
        if (!symbolEntry) {return null;} // 有符号就处理

        let defDocument: vscode.TextDocument;
        if (symbolEntry.uri.toString() === document.uri.toString()) {
            defDocument = document;
        } else {
            defDocument = await vscode.workspace.openTextDocument(symbolEntry.uri);
        }

        const symbol = symbolEntry.symbol;
        const markdown = new vscode.MarkdownString();

        if (symbol.kind === 'function') {
            const startLineNum = symbol.range.start.line;
            const originalSignature = defDocument.lineAt(startLineNum).text;
            let signatureLine = originalSignature.trim();

            // 如果已有 ->，直接显示
            if (signatureLine.includes('->')) {
                markdown.appendCodeblock(signatureLine, 'python');
            } else {
                // 否则，尝试推断返回类型
                let inferredReturnType = 'unknown';

                // 获取函数定义的缩进（用于判断函数体）
                const funcIndent = originalSignature.length - originalSignature.trimStart().length;

                // 向下扫描找第一个 return
                for (let i = 1; startLineNum + i < defDocument.lineCount; i++) {
                    const currentLineNum = startLineNum + i;
                    const line = defDocument.lineAt(currentLineNum).text;
                    const trimmed = line.trim();

                    if (trimmed === '' || trimmed.startsWith('#')) continue;

                    // 检查是否还在函数体内
                    const currentIndent = line.length - line.trimStart().length;
                    if (currentIndent <= funcIndent) break;

                    if (trimmed.startsWith('return ')) {
                        const returnValue = trimmed.substring('return '.length).trim();
                        // 简单类型推断
                        if (/^(".*?"|'.*?')$/.test(returnValue)) {
                            inferredReturnType = 'str';
                        } else if (/^\d+$/.test(returnValue)) {
                            inferredReturnType = 'int';
                        } else if (/^\d*\.\d+$/.test(returnValue)) {
                            inferredReturnType = 'float';
                        } else if (returnValue === 'True' || returnValue === 'False') {
                            inferredReturnType = 'bool';
                        } else if (returnValue === '[]') {
                            inferredReturnType = 'list';
                        } else if (returnValue === '{}') {
                            inferredReturnType = 'dict';
                        } else if (returnValue === 'None') {
                            inferredReturnType = 'None';
                        } else if (returnValue.startsWith('[') && returnValue.endsWith(']')) {
                            inferredReturnType = 'list';
                        } else if (returnValue.startsWith('{') && returnValue.endsWith('}')) {
                            inferredReturnType = 'dict';
                        }
                        break; // 只取第一个 return
                    }
                }

                // 拼接新签名：def name(...) -> inferred_type:
                const insertPos = signatureLine.indexOf(':');
                if (insertPos !== -1) {
                    signatureLine = signatureLine.slice(0, insertPos) + ` -> ${inferredReturnType}` + signatureLine.slice(insertPos);
                }

                markdown.appendCodeblock(signatureLine, 'python');
            }
        } else if (symbol.kind === 'class') {
            // 类：直接显示
            const signatureLine = defDocument.lineAt(symbol.range.start.line).text.trim();
            markdown.appendCodeblock(signatureLine, 'python');
        } else if (symbol.kind === 'variable') {
            // 推断类型并显示 name: type
            const line = defDocument.lineAt(symbol.range.start.line).text;
            const valueMatch = line.match(/=\s*(.+)/);
            let inferredType = 'unknown';

            if (valueMatch) {
                const value = valueMatch[1].trim();
                if (/^(".*?"|'.*?')$/.test(value)) {
                    inferredType = 'str';
                } else if (/^\d+$/.test(value)) {
                    inferredType = 'int';
                } else if (/^\d*\.\d+$/.test(value)) {
                    inferredType = 'float';
                } else if (value === 'True' || value === 'False') {
                    inferredType = 'bool';
                } else if (value === '[]') {
                    inferredType = 'list';
                } else if (value === '{}') {
                    inferredType = 'dict';
                } else if (value === 'None') {
                    inferredType = 'None';
                } else if (value.startsWith('[') && value.endsWith(']')) {
                    inferredType = 'list';
                } else if (value.startsWith('{') && value.endsWith('}')) {
                    inferredType = 'dict';
                }
            }

            markdown.appendCodeblock(`${name}: ${inferredType}`, 'python');
        }

        // docstring 是可选的
        if (symbol.docstring) {
            markdown.appendText('\n\n');
            markdown.appendText(symbol.docstring!);
        }

        return new vscode.Hover(markdown, wordRange);
    }
    });

    // 2. Definition Provider
    const defProvider = vscode.languages.registerDefinitionProvider('renpy', {
        provideDefinition(document, position, token) {
            if (!isInPythonBlock(document, position)) {return null;}

            const wordRange = document.getWordRangeAtPosition(position);
            if (!wordRange) {return null;}

            const name = document.getText(wordRange);
            const symbolEntry = globalSymbolIndex.getSymbol(name);
            if (symbolEntry) {
                return new vscode.Location(symbolEntry.uri, symbolEntry.symbol.range);
            }
            return null;
        }
    });

    // 3. 文档监听
    const docOpen = vscode.workspace.onDidOpenTextDocument(updateSymbolIndex);
    const docChange = vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.languageId === 'renpy') {
            updateSymbolIndex(e.document);
        }
    });

    // 4. 初始索引已打开的文档
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.languageId === 'renpy') {
            updateSymbolIndex(doc);
        }
    }

    // 5. 索引未打开的 .rpy 文件
    if (vscode.workspace.workspaceFolders) {
        const openUris = new Set(vscode.workspace.textDocuments.map(doc => doc.uri.toString()));
        const rpyFiles = await vscode.workspace.findFiles('**/*.rpy');
        for (const uri of rpyFiles) {
            if (!openUris.has(uri.toString())) {
                indexRpyFileFromDisk(uri);
            }
        }
    }

    // 6. 监听文件创建/删除
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.rpy');
    fileWatcher.onDidCreate(uri => indexRpyFileFromDisk(uri));
    fileWatcher.onDidDelete(uri => globalSymbolIndex.clearForDocument(uri));

    context.subscriptions.push(
        hoverProvider,
        defProvider,
        docOpen,
        docChange,
        fileWatcher
    );
    const rebuildIndexCmd = vscode.commands.registerCommand('renpy-symbol-index.rebuild', () => {
        rebuildIndex(context);
    });

    context.subscriptions.push(rebuildIndexCmd);
}

export function deactivate() {}