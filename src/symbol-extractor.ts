// src/symbol-extractor.ts
export interface LineMapEntry {
    rpyLine: number;
    pyLine: number;
    rpyColBase: number;
}

export interface PythonBlock {
    code: string;
    startLine: number;
    baseIndent: number;
    lineMap: LineMapEntry[];
    priority?: number;        // init 优先级
    store?: string;           // 存储区
    type?: 'python' | 'init' | 'single' | 'script'; // block 类型
}

export function extractPythonBlocks(text: string): PythonBlock[] {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const blocks: PythonBlock[] = [];

    let inPython = false;
    let baseIndent = 0;
    let startLine = 0;
    let buf: string[] = [];
    let lineMap: LineMapEntry[] = [];
    let currentPriority = 0;
    let currentStore = 'store';
    let blockType: 'python' | 'init' | 'single' = 'python';

    function flush() {
        if (inPython && buf.length) {
            blocks.push({
                code: buf.join('\n'),
                startLine,
                baseIndent,
                lineMap: [...lineMap],
                priority: currentPriority,
                store: currentStore,
                type: blockType
            });
        }
        inPython = false;
        buf = [];
        lineMap = [];
        currentPriority = 0;
        currentStore = 'store';
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const indent = line.length - trimmed.length;

        // ---------- init [数字] python ----------
        let initMatch = trimmed.match(/^init(?:\s+(-?\d+))?\s+python\s*:/);
        if (initMatch) {
            flush();
            inPython = true;
            baseIndent = indent;
            startLine = i + 1;
            currentPriority = initMatch[1] ? parseInt(initMatch[1], 10) : 0;
            blockType = 'init';
            continue;
        }

        // ---------- python in store ----------
        let inMatch = trimmed.match(/^python\s+in\s+([a-zA-Z0-9_.]+)\s*:/);
        if (inMatch) {
            flush();
            inPython = true;
            baseIndent = indent;
            startLine = i + 1;
            currentStore = inMatch[1];
            blockType = 'python';
            continue;
        }

        // ---------- 普通 python ----------
        if (/^python\s*:/.test(trimmed)) {
            flush();
            inPython = true;
            baseIndent = indent;
            startLine = i + 1;
            blockType = 'python';
            continue;
        }

        // ---------- 单行 $ ----------
        if (!inPython && trimmed.startsWith('$ ')) {
            blocks.push({
                code: trimmed.slice(2),
                startLine: i,
                baseIndent: indent,
                lineMap: [{
                    rpyLine: i,
                    pyLine: 0,
                    rpyColBase: indent + 2,
                }],
                type: 'single',
                store: 'store'
            });
            continue;
        }

        // ---------- define / default ----------
        if (!inPython && (trimmed.startsWith('define ') || trimmed.startsWith('default '))) {
            const varName = trimmed.startsWith('define ')
                ? trimmed.replace(/^define\s+/, '').split('=')[0].trim()
                : trimmed.slice(8).split('=')[0].trim();
            const pyLineCode = trimmed.startsWith('define ')
                ? trimmed.replace(/^define\s+/, '')
                : `${trimmed.slice(8)} if '${varName}' not in locals() else ${varName}`;
            if (!inPython && trimmed.startsWith('define ')) {
                blocks.push({
                    code: trimmed.replace(/^define\s+/, ''),
                    startLine: i,
                    baseIndent: indent,
                    lineMap: [{ rpyLine: i, pyLine: 0, rpyColBase: indent }],
                    type: 'init',
                    priority: 0,
                    store: 'store',
                });
                continue;
            }

            if (!inPython && trimmed.startsWith('default ')) {
                blocks.push({
                    code: `${trimmed.slice(8)} if '${varName}' not in locals() else ${varName}`,
                    startLine: i,
                    baseIndent: indent,
                    lineMap: [{ rpyLine: i, pyLine: 0, rpyColBase: indent }],
                    type: 'script',
                    store: 'store',
                });
                continue;
            }
        }

        // ---------- python block body ----------
        if (inPython) {
            if (trimmed && indent <= baseIndent) {
                flush();
                i--; // 重新作为 Ren'Py 行处理
                continue;
            }

            buf.push(line);
            lineMap.push({
                rpyLine: i,
                pyLine: buf.length - 1,
                rpyColBase: indent,  // 用原始行缩进而不是 0
            });
        }
    }

    flush();
    return blocks;
}
