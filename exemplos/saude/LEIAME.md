# Saúde de clientes (modelo)

Painel de saúde de uma carteira de clientes, portado do template "Customer health" do Lovable como **segundo modelo** do Polaris (o primeiro é a Maison). Serve de termômetro para o que faltava: **gráficos**, tabela com mini-gráficos, gaveta de detalhe e tema claro/escuro.

```
node exemplos/saude/gera.mjs                                   # gera nos.json e conta.sementes
pnpm local --site exemplos/maison --modelo exemplos/saude      # o painel fica guardado como modelo (Studio > Modelos > Aplicar e publicar)
pnpm local --site exemplos/saude                               # ou sobe direto como o site
```

- **Dados**: as 160 contas (30 Enterprise, 55 Mid-Market, 75 SMB; ARR ~US$ 26,6 M; ~28 em risco) são geradas de forma determinística (`dados.mjs`) e entram pela API (entidade `conta` do serviço `loja`, `conta.sementes`). A página lê duas páginas de 100 pelos nós `dados` `saude.contas1` e `saude.contas2`. Os indicadores (ARR em risco, contas em risco, mediana, renovações em 90 dias) e as variações contra 4 semanas atrás são **derivados** dos dados, nada digitado.
- **Gráficos**: o enxame de bolhas (combinado ou por segmento, com filtro), a linha de tendência de 13 semanas e a cascata da composição do índice são composições das primitivas `grafico/*` com as funções `enxame`, `escala`, `raiz`, `mediana`, `compacto` e `dataCurta` (`docs/blocos-base.md`). Cor por `color-mix` entre `grafico.risco` e `grafico.neutro` conforme o índice.
- **Tema** `saude`: fontes embutidas Newsreader, Work Sans e IBM Plex Mono; escuro por padrão e o modo `claro` por estado persistente (prop `modo`); escala tipográfica com família (`escala.<nome>.familia`); tokens `grafico` e `painel`.
- **Textos**: pt-BR e en em `idiomas.mjs` (só chaves nas páginas).
- **O que não é igual**: o ícone de sol/lua do botão de modo (usa `tema-escuro`), a seção de links do guia (o texto do guia fala do Polaris, não do Lovable) e o piso de teclado nas bolhas (focáveis com Tab, mas sem seta para navegar).
