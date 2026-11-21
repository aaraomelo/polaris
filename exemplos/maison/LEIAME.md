# Maison: o template "Homeware store" do Lovable portado para o Polaris

Primeira fatia do porte: o **tema** (`maison`: paleta terracota, linho e carvão, claro e escuro, títulos em serifa) e a **página inicial** (cabeçalho, abertura com foto, coleção em destaque, novidades, coleções, faixa de fotos e rodapé).

```bash
node exemplos/maison/gera.mjs                     # gera nos.json (tema, páginas, tenants) a partir deste script
pnpm local --memoria --site exemplos/maison       # http://loja-demo.polaris.localhost:3000/
```

- `gera.mjs` descreve o tema e a página em JavaScript e escreve `nos.json`; as fotos estão em `img/` (13 JPEGs do Unsplash usados pela home do template, ~0,9 MB).
- Texto em pt-BR e nomes de coleções e produtos de **exemplo** (o template tem outros).
- A auditoria de contraste (AA) passa nos dois modos; por isso o terracota e o cinza do texto suave são um pouco mais escuros que os do template.

## Primitivas de layout criadas para o porte
`layout/contido` (largura máxima centrada), `texto/sobretitulo`, imagem `fluida` com `proporcao`, `alinha` na grade, `centro` no cabeçalho e a escala tipográfica do tema (`tamanhoH1..H3`, `familiaTitulo`, `layout.largura*`). Estão descritas em `docs/blocos-base.md`; nenhum tema existente muda.

## O que ainda não está igual ao template
O cabeçalho do template é translúcido (desfoque) e a fonte Cormorant Garamond não é carregada (CSP): os títulos usam a serifa do sistema. As páginas de produtos, detalhe, sacola, checkout e sobre ainda não foram portadas.
