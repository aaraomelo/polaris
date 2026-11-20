# Maison: o template "Homeware store" do Lovable portado para o Polaris

Primeira fatia do porte: o **tema** (`maison`: paleta terracota, linho e carvão, claro e escuro, títulos em serifa) e a **página inicial** (cabeçalho, abertura com foto, coleção em destaque, novidades, coleções, faixa de fotos e rodapé).

```bash
node exemplos/maison/gera.mjs                     # gera nos.json (tema, páginas, tenants) a partir deste script
pnpm local --memoria --site exemplos/maison       # http://loja-demo.polaris.localhost:3000/
```

- `gera.mjs` descreve o tema e a página em JavaScript e escreve `nos.json`; as fotos estão em `img/` (13 JPEGs do Unsplash usados pela home do template, ~0,9 MB).
- Texto em pt-BR e nomes de coleções e produtos de **exemplo** (o template tem outros).
- A auditoria de contraste (AA) passa nos dois modos; por isso o terracota e o cinza do texto suave são um pouco mais escuros que os do template.

## O que ainda não está igual ao template
Falta **acabamento de layout**, que pede primitivas novas na plataforma: um contêiner com largura máxima e margens (hoje as seções vão de ponta a ponta), imagens fluidas (as imagens têm largura fixa em px), escala tipográfica do tema (o título da abertura é grande e em itálico no template) e o cabeçalho claro e translúcido com o menu centralizado. As páginas de produtos, detalhe, sacola, checkout e sobre ainda não foram portadas.
