// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { globalSymbolIndex } from './symbol-index';
import { extractDocstring, extractPythonBlocksWithLineInfo, parsePythonBlockForSymbols } from './symbol-extractor';
import * as fs from 'fs';
import * as path from 'path';
/**
 * 判断当前位置是否在 python: 或 init python: 块中
 */
function isInPythonBlock(document: vscode.TextDocument, position: vscode.Position): boolean {
    const curLine = position.line;
    let indentLevel = -1;
    let inPython = false;

    // 从当前行向上扫描
    for (let i = curLine; i >= 0; i--) {
        const line = document.lineAt(i);
        const text = line.text;
        const trimmed = text.trim();

        // 跳过空行和注释
        if (trimmed === '' || trimmed.startsWith('#')) {
            continue;
        }

        // 检查是否是 python 块开始
        if (/^(init\s+)?python\s*:/.test(trimmed)) {
            inPython = true;
            indentLevel = text.length - trimmed.length;
            break;
        }

        // 如果之前已找到 python 块，但当前行缩进 <= 块缩进，说明已离开
        if (indentLevel !== -1) {
            const currentIndent = text.length - trimmed.length;
            if (currentIndent <= indentLevel) {
                break;
            }
        }
    }

    return inPython;
}
/**
 * 提取整个文档中的所有 python 块
 */
function extractPythonBlocks(documentText: string): string[] {
    const blocks: string[] = [];
    const lines = documentText.split('\n');
    let inPython = false;
    let currentBlock: string[] = [];
    let baseIndent = -1;

    for (const line of lines) {
        const trimmed = line.trim();

        if (/^(init\s+)?python\s*:/.test(trimmed)) {
            // 开始新块
            if (inPython) {
                // 理论上不会嵌套，直接结束上一个
                blocks.push(currentBlock.join('\n'));
                currentBlock = [];
            }
            inPython = true;
            baseIndent = line.length - trimmed.length;
            continue;
        }

        if (inPython) {
            if (trimmed === '' || trimmed.startsWith('#')) {
                currentBlock.push(line);
                continue;
            }

            const currentIndent = line.length - trimmed.length;
            if (currentIndent <= baseIndent) {
                // 退出 python 块
                blocks.push(currentBlock.join('\n'));
                currentBlock = [];
                inPython = false;
                baseIndent = -1;
            } else {
                currentBlock.push(line);
            }
        }
    }

    // 结束最后一个块
    if (inPython && currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
    }

    return blocks;
}

function updateSymbolIndex(document: vscode.TextDocument) {
    if (document.languageId !== 'renpy') {return;}

    globalSymbolIndex.clearForDocument(document.uri);

    const blocks = extractPythonBlocksWithLineInfo(document.getText());
    for (const block of blocks) {
        const symbols = parsePythonBlockForSymbols(block.code, block.startLine);
        for (const sym of symbols) {
            globalSymbolIndex.addSymbol(document.uri, document, sym);
        }
    }
}
// 递归获取所有 .rpy 文件
function getAllRpyFiles(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            results = results.concat(getAllRpyFiles(filePath));
        } else if (file.endsWith('.rpy')) {
            results.push(filePath);
        }
    }
    return results;
}
// 从文件路径读取内容并索引
async function indexRpyFileFromDisk(filePath: string) {
    try {
        const content = await fs.promises.readFile(filePath, 'utf8');
        const uri = vscode.Uri.file(filePath);
        
        // 创建一个虚拟 TextDocument（仅用于索引）
        const document = {
            uri: uri,
            getText: () => content,
            languageId: 'renpy'
        } as vscode.TextDocument;

        globalSymbolIndex.clearForDocument(uri); // 清除旧索引

        const blocks = extractPythonBlocksWithLineInfo(content);
        for (const block of blocks) {
            const symbols = parsePythonBlockForSymbols(block.code, block.startLine);
            for (const sym of symbols) {
                globalSymbolIndex.addSymbol(uri, document, sym);
            }
        }
    } catch (e) {
        console.warn(`Failed to index ${filePath}:`, e);
    }
}
export function activate(context: vscode.ExtensionContext) {

    // 1. Hover Provider
    const hoverProvider = vscode.languages.registerHoverProvider('renpy', {
        provideHover(document, position, token) {
            if (!isInPythonBlock(document, position)) {return null;}

            const wordRange = document.getWordRangeAtPosition(position);
            if (!wordRange) {return null;}

            const name = document.getText(wordRange);
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {return null;}

            const text = document.getText();
            const blocks = extractPythonBlocks(text);

            for (const block of blocks) {
                const doc = extractDocstring(block, name);
                if (doc) {
                    const markdown = new vscode.MarkdownString();
                    markdown.appendCodeblock(`${name}`, 'python');
                    markdown.appendText('\n\n');
                    markdown.appendText(doc);
                    return new vscode.Hover(markdown, wordRange);
                }
            }
            const symbolEntry = globalSymbolIndex.getSymbol(name);
            if (symbolEntry && symbolEntry.symbol.docstring) {
                const markdown = new vscode.MarkdownString();
                markdown.appendCodeblock(`${name}`, 'python');
                markdown.appendText('\n\n');
                markdown.appendText(symbolEntry.symbol.docstring);
                return new vscode.Hover(markdown, wordRange);
}
            return null;
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
                return new vscode.Location(
                    symbolEntry.document.uri,
                    symbolEntry.symbol.range
                );
            }
            return null;
        }
    });

    // 3. 文档更新监听（用于重建索引）
    const docOpen = vscode.workspace.onDidOpenTextDocument(updateSymbolIndex);
    const docChange = vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.languageId === 'renpy') {
            updateSymbolIndex(e.document);
        }
    });

    // 4. 初始打开的文档也索引
    vscode.workspace.textDocuments.forEach(doc => {
        if (doc.languageId === 'renpy') {
            updateSymbolIndex(doc);
        }
    });

    // 5. 订阅所有
    context.subscriptions.push(
        hoverProvider,
        defProvider,
        docOpen,
        docChange
    );
    if (vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
            const rpyFiles = getAllRpyFiles(folder.uri.fsPath);
            rpyFiles.forEach(file => {
                indexRpyFileFromDisk(file);
            });
        }
    }

    // ========== 监听文件创建/删除 ==========
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.rpy');
    fileWatcher.onDidCreate(uri => indexRpyFileFromDisk(uri.fsPath));
    fileWatcher.onDidDelete(uri => globalSymbolIndex.clearForDocument(uri));

    context.subscriptions.push(fileWatcher);
}

export function deactivate() {}