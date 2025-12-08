// src/symbol-index.ts
import * as vscode from 'vscode';
import { SymbolInfo } from './symbol-extractor';

export class SymbolIndex {
    // 支持多文件：Map<fileName, Map<symbolName, ...>>
    private symbols: Map<string, Map<string, { document: vscode.TextDocument; symbol: SymbolInfo }>> = new Map();

    addSymbol(uri: vscode.Uri, document: vscode.TextDocument, symbol: SymbolInfo) {
        const fileName = uri.fsPath;
        if (!this.symbols.has(fileName)) {
            this.symbols.set(fileName, new Map());
        }
        this.symbols.get(fileName)!.set(symbol.name, { document, symbol });
    }

    getSymbol(name: string): { document: vscode.TextDocument; symbol: SymbolInfo } | undefined {
        for (const fileMap of this.symbols.values()) {
            if (fileMap.has(name)) {
                return fileMap.get(name);
            }
        }
        return undefined;
    }

    clearForDocument(uri: vscode.Uri) {
        const fileName = uri.fsPath;
        this.symbols.delete(fileName);
    }
}

export const globalSymbolIndex = new SymbolIndex();