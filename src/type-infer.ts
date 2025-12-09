// src/type-infer.ts
export function inferTypeFromExpression(expr: string): string | undefined {
    expr = expr.trim();

    if (/^(".*?"|'.*?')$/.test(expr)) return 'str';
    if (/^\d+$/.test(expr)) return 'int';
    if (/^\d*\.\d+$/.test(expr)) return 'float';
    if (expr === 'True' || expr === 'False') return 'bool';
    if (expr === 'None') return 'None';

    if (expr.startsWith('[')) return 'list';
    if (expr.startsWith('{')) {
        return expr.includes(':') ? 'dict' : 'set';
    }
    if (expr.startsWith('(')) return 'tuple';

    // 构造调用 Foo(...)
    const callMatch = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (callMatch) {
        return callMatch[1];
    }

    return undefined;
}
