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
            const line = defDocument.lineAt(symbol.range.start.line).text.trim();
            // 如果已经有 ->，直接显示
            if (line.includes('->')) {
                markdown.appendCodeblock(line, 'python');
            } else {
                const inferred = symbol.inferredType ?? 'unknown';

                // 找 “):” 或 “) :”
                const sigMatch = line.match(/\)\s*:/);

                if (sigMatch && sigMatch.index !== undefined) {
                    const insertPos = sigMatch.index + sigMatch[0].length - 1; // 冒号位置
                    const newSig =
                        line.slice(0, insertPos)
                        + ` -> ${inferred}`
                        + line.slice(insertPos);

                    markdown.appendCodeblock(newSig, 'python');
                } else {
                    // 极端异常兜底
                    markdown.appendCodeblock(line, 'python');
                }
            }
        } else if (symbol.kind === 'class') {
            // 类：直接显示
            const signatureLine = defDocument.lineAt(symbol.range.start.line).text.trim();
            markdown.appendCodeblock(signatureLine, 'python');
        } else if (symbol.kind === 'variable') {
            markdown.appendCodeblock(`${name}: ${symbol.inferredType ?? 'unknown'}`, 'python');
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