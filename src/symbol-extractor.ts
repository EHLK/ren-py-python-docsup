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
}

export function extractPythonBlocks(text: string): PythonBlock[] {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const blocks: PythonBlock[] = [];

    let inPython = false;
    let baseIndent = 0;
    let startLine = 0;
    let buf: string[] = [];
    let lineMap: LineMapEntry[] = [];

    function flush() {
        if (inPython && buf.length) {
            blocks.push({
                code: buf.join('\n'),
                startLine,
                baseIndent,
                lineMap: [...lineMap],
            });
        }
        inPython = false;
        buf = [];
        lineMap = [];
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const indent = line.length - trimmed.length;

        /* ---------- python / init python ---------- */
        if (/^(init\s+)?python\s*:/.test(trimmed)) {
            flush();
            inPython = true;
            baseIndent = indent;
            startLine = i + 1;
            continue;
        }

        /* ---------- 单行 $ ---------- */
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
            });
            continue;
        }

        /* ---------- python block body ---------- */
        if (inPython) {
            // 退出条件：缩进退回
            if (trimmed && indent <= baseIndent) {
                flush();
                i--; // 重新作为 Ren'Py 行处理
                continue;
            }

            // 允许空行
            if (!trimmed) {
                buf.push('');
                lineMap.push({
                    rpyLine: i,
                    pyLine: buf.length - 1,
                    rpyColBase: indent,
                });
                continue;
            }

            const colBase = line.indexOf(trimmed) + 4;
            const pyLine = buf.length;

            buf.push(line.slice(colBase));
            lineMap.push({
                rpyLine: i,
                pyLine,
                rpyColBase: colBase,
            });
        }
    }

    flush();
    return blocks;
}
