/** JSON seguro para <script type="application/json">: nada de </script>, <!-- ou U+2028/9 (todos os <, > e & ficam escapados). */
export function jsonSeguro(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}
