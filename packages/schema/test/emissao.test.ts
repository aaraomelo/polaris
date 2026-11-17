import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EmissaoErro, alvosDe, emite, emiteDeclaradas, jsonCanonico, KINDS, type Alvo, type No } from '../src/index'

const no = (kind: string, id: string, spec: object, extra: object = {}) => ({ kind, id, versao: '1.0.0', spec, ...extra }) as unknown as No

describe('matriz kind × alvo', () => {
  it('todo kind emite json, js e tex; css/sql/html só nos kinds certos', () => {
    for (const k of KINDS) expect(alvosDe(k)).toEqual(expect.arrayContaining(['json', 'js', 'tex']))
    expect(alvosDe('tema')).toContain('css')
    expect(alvosDe('servico')).toContain('sql')
    expect(alvosDe('pagina')).toContain('html')
    expect(alvosDe('tema')).not.toContain('sql')
    expect(alvosDe('evento')).toEqual(['json', 'js', 'tex'])
  })

  it('alvo sem suporte no kind: erro que lista os disponíveis', () => {
    expect(() => emite(no('tema', 't', { tokens: {} }), 'sql')).toThrow(/não tem emissão 'sql'.*json, js, tex, css/)
  })

  it('todas as fixtures congeladas emitem em todos os alvos suportados', () => {
    const dir = join(__dirname, 'congelados', 'v1')
    for (const f of readdirSync(dir)) {
      const n = JSON.parse(readFileSync(join(dir, f), 'utf8')) as No
      for (const a of alvosDe(n.kind)) expect(() => emite(n, a), `${f} → ${a}`).not.toThrow()
    }
  })
})

describe('json canônico (nenhuma emissão é privilegiada)', () => {
  const a = no('tema', 't', { tokens: { cor: { b: '#2', a: '#1' } }, modos: {} }, { estatuto: 'publicado' })
  const b = { estatuto: 'publicado', spec: { modos: {}, tokens: { cor: { a: '#1', b: '#2' } } }, versao: '1.0.0', id: 't', kind: 'tema' } as unknown as No

  it('independe da ordem das chaves', () => {
    expect(emite(a, 'json')).toBe(emite(b, 'json'))
  })
  it('é determinístico e termina com \\n', () => {
    expect(emite(a, 'json')).toBe(emite(a, 'json'))
    expect(emite(a, 'json').endsWith('}\n')).toBe(true)
  })
  it('ida e volta preserva o nó', () => {
    expect(JSON.parse(emite(a, 'json'))).toEqual(JSON.parse(JSON.stringify(a)))
  })
  it('ordena em todos os níveis, mantém a ordem das listas e descarta undefined', () => {
    expect(jsonCanonico({ z: 1, a: [{ y: 1, x: 2 }, 3], u: undefined })).toBe('{\n  "a": [\n    {\n      "x": 2,\n      "y": 1\n    },\n    3\n  ],\n  "z": 1\n}\n')
  })
})

describe('css (tema)', () => {
  const tema = no('tema', 'tema.base', {
    tokens: { cor: { primaria: '#6C3AED', fundoClaro: '#fff' }, espacamento: { 1: 4, 2: 8 }, raio: { m: 6 }, tipografia: { corpo: { familia: "'Inter', sans-serif", tamanho: '16px' } } },
    modos: { escuro: { cor: { primaria: '#A78BFA' } } },
  })

  it('gera custom properties, unidades para espaçamento/raio e modos', () => {
    expect(emite(tema, 'css')).toBe(`/* polaris: tema tema.base@1.0.0 */
:root {
  --cor-fundo-claro: #fff;
  --cor-primaria: #6C3AED;
  --espacamento-1: 4px;
  --espacamento-2: 8px;
  --raio-m: 6px;
  --tipografia-corpo-familia: 'Inter', sans-serif;
  --tipografia-corpo-tamanho: 16px;
}

[data-modo="escuro"] {
  --cor-primaria: #A78BFA;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-modo]) {
    --cor-primaria: #A78BFA;
  }
}
`)
  })

  it('a saída não depende da ordem das chaves, nem nos tokens aninhados', () => {
    const a = no('tema', 't', { tokens: { tipografia: { corpo: { z: '1', a: '2' }, base: { m: '3' } }, cor: { b: '#2', a: '#1' } } })
    const b = no('tema', 't', { tokens: { cor: { a: '#1', b: '#2' }, tipografia: { base: { m: '3' }, corpo: { a: '2', z: '1' } } } })
    expect(emite(a, 'css')).toBe(emite(b, 'css'))
  })

  it('recusa valor que escaparia da declaração (injeção de CSS)', () => {
    for (const v of ['red; } body { display:none', 'x</style><script>', 'url(http://x)\\', 'a/*b*/c', '{x}']) {
      expect(() => emite(no('tema', 't', { tokens: { cor: { a: v } } }), 'css'), v).toThrow(EmissaoErro)
    }
  })
  it('recusa nome de token, grupo e modo inválidos', () => {
    expect(() => emite(no('tema', 't', { tokens: { tipografia: { 'a b': 'x' } } }), 'css')).toThrow(/nome de token/)
    expect(() => emite(no('tema', 't', { tokens: { 'x;y': { a: '1' } } }), 'css')).toThrow(/grupo/)
    expect(() => emite(no('tema', 't', { tokens: {}, modos: { 'e"scuro': { cor: { a: '#1' } } } }), 'css')).toThrow(/modo/)
  })
})

describe('sql (servico)', () => {
  const svc = no('servico', 'catalogo', {
    entidades: {
      produto: {
        campos: {
          nome: { tipo: 'texto', obrigatorio: true },
          precoUnitario: { tipo: 'dinheiro', obrigatorio: true },
          ativo: { tipo: 'booleano', padrao: true },
          tags: { tipo: 'texto', lista: true },
          extra: { tipo: 'json', padrao: { a: "it's" } },
          obs: { tipo: 'texto', padrao: "d'água" },
        },
        indices: [['nome'], ['ativo', 'precoUnitario']],
      },
    },
    operacoes: {},
  })

  it('gera tabela com id, tenant_id, colunas tipadas, auditoria, índices e RLS com WITH CHECK', () => {
    expect(emite(svc, 'sql')).toBe(`-- polaris: servico catalogo@1.0.0
CREATE SCHEMA IF NOT EXISTS "catalogo";

CREATE TABLE IF NOT EXISTS "catalogo"."produto" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "nome" text NOT NULL,
  "preco_unitario" numeric(19,4) NOT NULL,
  "ativo" boolean DEFAULT TRUE,
  "tags" text[],
  "extra" jsonb DEFAULT '{"a":"it''s"}'::jsonb,
  "obs" text DEFAULT 'd''água',
  "criado_em" timestamptz NOT NULL DEFAULT now(),
  "atualizado_em" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "produto_tenant_id_uidx" ON "catalogo"."produto" ("tenant_id", "id");
CREATE INDEX IF NOT EXISTS "produto_tenant_idx" ON "catalogo"."produto" ("tenant_id");
CREATE INDEX IF NOT EXISTS "produto_nome_idx" ON "catalogo"."produto" ("tenant_id", "nome");
CREATE INDEX IF NOT EXISTS "produto_ativo_preco_unitario_idx" ON "catalogo"."produto" ("tenant_id", "ativo", "preco_unitario");
ALTER TABLE "catalogo"."produto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalogo"."produto" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "produto_tenant" ON "catalogo"."produto";
CREATE POLICY "produto_tenant" ON "catalogo"."produto"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
`)
  })

  it('toda tabela tem tenant_id NOT NULL e RLS, mesmo com várias entidades', () => {
    const s = no('servico', 'x', { entidades: { a: { campos: {} }, b: { campos: {} } }, operacoes: {} })
    const sql = emite(s, 'sql')
    expect(sql.match(/"tenant_id" uuid NOT NULL/g)).toHaveLength(2)
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(2)
    expect(sql.match(/WITH CHECK/g)).toHaveLength(2)
  })

  it('campo que colide com coluna reservada é erro', () => {
    for (const c of ['id', 'tenantId', 'criadoEm', 'atualizadoEm']) {
      expect(() => emite(no('servico', 's', { entidades: { a: { campos: { [c]: { tipo: 'texto' } } } }, operacoes: {} }), 'sql'), c).toThrow(/reservada/)
    }
  })
  it('índice com campo inexistente é erro', () => {
    expect(() => emite(no('servico', 's', { entidades: { a: { campos: { x: { tipo: 'texto' } }, indices: [['y']] } }, operacoes: {} }), 'sql')).toThrow(/inexistente 'y'/)
  })
  it('identificadores são sempre citados (id do serviço com ponto/hífen e aspas)', () => {
    const sql = emite(no('servico', 'loja-1.v2', { entidades: { a: { campos: {} } }, operacoes: {} }), 'sql')
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "loja-1.v2";')
  })
})

describe('html (pagina)', () => {
  const pagina = no('pagina', 'home', {
    rota: '/', titulo: '{loja.nome} <b>',
    raiz: {
      bloco: 'layout/pilha', id: 'topo',
      slots: { filhos: [
        { bloco: 'commerce/vitrine', props: { colecao: 'destaques', colunas: 3 } },
        { bloco: 'texto/titulo', props: { texto: '{produto.nome}' }, repetir: { cada: 'produtos', como: 'produto' }, se: 'produtos.length' },
      ] },
    },
  })

  it('gera HTML canônico com blocos como custom elements, slots, props, se e repetir', () => {
    expect(emite(pagina, 'html')).toBe(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{loja.nome} &lt;b&gt;</title>
</head>
<body data-pagina="home" data-versao="1.0.0" data-rota="/">
  <pl-layout--pilha id="topo">
    <div data-slot="filhos">
      <pl-commerce--vitrine data-props="{&quot;colecao&quot;:&quot;destaques&quot;,&quot;colunas&quot;:3}"></pl-commerce--vitrine>
      <pl-texto--titulo data-se="produtos.length" data-repetir-cada="produtos" data-repetir-como="produto" data-props="{&quot;texto&quot;:&quot;{produto.nome}&quot;}"></pl-texto--titulo>
    </div>
  </pl-layout--pilha>
</body>
</html>
`)
  })

  it('escapa conteúdo hostil em atributos e título', () => {
    const p = no('pagina', 'x', { rota: '/', titulo: '</title><script>alert(1)</script>', raiz: { bloco: 'a/b', id: '"><img src=x onerror=1>', props: { t: '"><script>' } } })
    const h = emite(p, 'html')
    expect(h).not.toContain('<script')
    expect(h).not.toContain('<img')
    expect(h).toContain('&lt;/title&gt;&lt;script&gt;')
    expect(h).toContain('&quot;&gt;&lt;img')
    expect(h.match(/<title>/g)).toHaveLength(1)
  })

  it('props ordenadas: a saída não depende da ordem das chaves', () => {
    const a = no('pagina', 'x', { rota: '/', raiz: { bloco: 'a/b', props: { b: 1, a: 2 } } })
    const b = no('pagina', 'x', { rota: '/', raiz: { bloco: 'a/b', props: { a: 2, b: 1 } } })
    expect(emite(a, 'html')).toBe(emite(b, 'html'))
  })
})

describe('js e tex', () => {
  it('js: módulo ESM com kind/id/versao e o nó canônico; seguro contra </script> e U+2028', () => {
    const n = no('tema', 'tema.base', { tokens: { cor: { a: '</script> x' } } })
    const js = emite(n, 'js')
    expect(js).toMatch(/^\/\/ polaris: tema tema\.base@1\.0\.0\nexport const kind = "tema";\nexport const id = "tema\.base";\nexport const versao = "1\.0\.0";\nexport default \{/)
    expect(js).not.toContain('</script>')
    expect(js).not.toContain(' ')
    const corpo = js.slice(js.indexOf('export default ') + 15).replace(/;\s*$/, '')
    expect(JSON.parse(corpo).spec.tokens.cor.a).toBe('</script> x')
  })

  it('tex: ficha com escape dos caracteres especiais', () => {
    const n = no('tema', 'tema_base', { tokens: { cor: { a: '50% & #1 $x {y} ~z ^w \\v' } } })
    const t = emite(n, 'tex')
    expect(t).toContain('\\subsection*{tema: tema\\_base}')
    expect(t).toContain('50\\% \\& \\#1 \\$x \\{y\\} \\textasciitilde{}z \\textasciicircum{}w \\textbackslash{}v')
    expect(t).toContain('escopo & core')
    expect(t).not.toMatch(/[^\\]_[^\\{]/)
  })

  it('tex mostra o escopo de tenant e de segmento', () => {
    expect(emite(no('tema', 't', { tokens: {} }, { tenantId: 'loja-1' }), 'tex')).toContain('tenant & loja-1')
    expect(emite(no('tema', 't', { tokens: {} }, { segmento: 'varejo' }), 'tex')).toContain('segmento & varejo')
  })
})

describe('emiteDeclaradas', () => {
  it('padrão é json', () => {
    expect(Object.keys(emiteDeclaradas(no('tema', 't', { tokens: {} })).saida)).toEqual(['json'])
  })
  it('emite os alvos pedidos e delega os de outros backends', () => {
    const k = no('kernel', 'k', { entradas: {}, saidas: {} }, { emit: ['json', 'glsl', 'wasm'] })
    const r = emiteDeclaradas(k)
    expect(Object.keys(r.saida)).toEqual(['json'])
    expect(r.delegadas).toEqual(['glsl', 'wasm'])
  })
  it('alvo pedido que o kind não suporta é erro', () => {
    expect(() => emiteDeclaradas(no('tema', 't', { tokens: {} }, { emit: ['sql'] }))).toThrow(EmissaoErro)
  })
  it('emite css de um tema declarado', () => {
    const r = emiteDeclaradas(no('tema', 't', { tokens: { cor: { a: '#1' } } }, { emit: ['css', 'json'] }))
    expect(r.saida.css).toContain('--cor-a: #1;')
    expect(Object.keys(r.saida).sort()).toEqual(['css', 'json'] as Alvo[])
  })
})
