// src/symbol-index.ts
import * as vscode from 'vscode';
import { SymbolInfo } from './symbol-extractor';

interface SymbolEntry {
    uri: vscode.Uri;
    symbol: SymbolInfo;
}

export class SymbolIndex {
    private symbols: Map<string, Map<string, SymbolEntry>> = new Map();

    addSymbol(uri: vscode.Uri, symbol: SymbolInfo) {
        const fileName = uri.fsPath;
        if (!this.symbols.has(fileName)) {
            this.symbols.set(fileName, new Map());
        }
        this.symbols.get(fileName)!.set(symbol.name, { uri, symbol });
    }

    getSymbol(name: string): SymbolEntry | undefined {
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
    clearAll() {
        this.symbols.clear();
    }
}

export const globalSymbolIndex = new SymbolIndex();