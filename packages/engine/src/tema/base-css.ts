// Folha de estilo dos blocos base, escrita SÓ com variáveis do tema (nenhuma cor/medida fixa): trocar o tema ou o modo reestiliza tudo.
// Os blocos emitem tags semânticas (e `data-tom`, `role`), então o estilo se prende a elas dentro do contêiner `#polaris`.
export const BASE_CSS = `/* polaris: estilos base dos blocos (usa só variáveis do tema) */
body{margin:0;background:var(--cor-fundo);color:var(--cor-texto);font-family:var(--tipografia-familia);font-size:var(--tipografia-tamanho-base);line-height:1.5}
#polaris h1,#polaris h2,#polaris h3,#polaris h4,#polaris h5,#polaris h6{margin:0 0 var(--espacamento-base);line-height:1.25}
#polaris p{margin:0 0 var(--espacamento-base)}
#polaris a{color:var(--cor-primaria)}
#polaris a:hover{color:var(--cor-primaria-hover)}
#polaris :focus-visible{outline:2px solid var(--cor-destaque);outline-offset:2px}
#polaris button{background:var(--cor-primaria);color:var(--cor-texto-sobre-primaria);border:var(--espacamento-borda) solid transparent;border-radius:var(--raio-pequeno);padding:calc(var(--espacamento-base) * .75) calc(var(--espacamento-base) * 1.5);font:inherit;cursor:pointer}
#polaris button:hover:not(:disabled){background:var(--cor-primaria-hover)}
#polaris button:disabled{opacity:.55;cursor:not-allowed}
#polaris input[type=text],#polaris input[type=number],#polaris input[type=search]{background:var(--cor-superficie);color:var(--cor-texto);border:var(--espacamento-borda) solid var(--cor-borda);border-radius:var(--raio-pequeno);padding:calc(var(--espacamento-base) * .75);font:inherit}
#polaris form[role=search]{display:flex;align-items:center;gap:var(--espacamento-base);margin:0}
#polaris form[role=search] input[type=search]{min-width:12ch;flex:1}
#polaris input::placeholder{color:var(--cor-texto-suave)}
#polaris input:disabled{opacity:.55}
#polaris input[type=checkbox]{accent-color:var(--cor-primaria);width:1.1em;height:1.1em}
#polaris label{display:inline-block}
#polaris small{color:var(--cor-texto-suave)}
#polaris code{background:var(--cor-superficie-alt);border-radius:var(--raio-pequeno);padding:.1em .4em;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
#polaris header{display:flex;align-items:center;gap:calc(var(--espacamento-base) * 2);padding:var(--espacamento-base) calc(var(--espacamento-base) * 2);background:var(--cor-superficie);border-bottom:var(--espacamento-borda) solid var(--cor-borda)}
#polaris header[data-fixo]{position:sticky;top:0;z-index:10}
#polaris header>a{display:flex;align-items:center;gap:var(--espacamento-base);color:var(--cor-texto);text-decoration:none}
#polaris nav{display:flex;flex-wrap:wrap;align-items:center;gap:calc(var(--espacamento-base) * 2)}
#polaris header>nav{flex:1}
#polaris nav a{text-decoration:none}
#polaris nav a[aria-current=page]{color:var(--cor-texto);font-weight:600;text-decoration:underline}
#polaris section[data-alinha]{display:flex;flex-direction:column;justify-content:center;gap:calc(var(--espacamento-base) * 2);padding:calc(var(--espacamento-base) * 6) calc(var(--espacamento-base) * 3);background-size:cover;background-position:center;border-radius:var(--raio-grande)}
#polaris section[data-fundo=primaria]{background-color:var(--cor-primaria);color:var(--cor-texto-sobre-primaria)}
#polaris section[data-fundo=suave]{background-color:var(--cor-superficie-alt);color:var(--cor-texto)}
#polaris section[data-alinha=centro]{align-items:center;text-align:center}
#polaris section[data-alinha=esquerda]{align-items:flex-start;text-align:left}
#polaris section[data-alinha] h1,#polaris section[data-alinha] h2,#polaris section[data-alinha] p{margin:0}
#polaris section[data-alinha] a:not([data-botao]){color:inherit}
#polaris a[data-botao]{display:inline-block;padding:calc(var(--espacamento-base) * 1.25) calc(var(--espacamento-base) * 2.5);border:var(--espacamento-borda) solid transparent;border-radius:var(--raio-pequeno);font-weight:600;text-decoration:none}
#polaris a[data-botao=primario]{background:var(--cor-primaria);color:var(--cor-texto-sobre-primaria)}
#polaris a[data-botao=primario]:hover{background:var(--cor-primaria-hover);color:var(--cor-texto-sobre-primaria)}
#polaris a[data-botao=secundario]{background:transparent;color:var(--cor-primaria);border-color:currentColor}
#polaris section[data-fundo=primaria] a[data-botao=primario]{background:var(--cor-texto-sobre-primaria);color:var(--cor-primaria)}
#polaris section[data-fundo=primaria] a[data-botao=secundario]{color:var(--cor-texto-sobre-primaria)}
/* com imagem de fundo o véu (scrim) é SEMPRE preto, então o texto é branco em qualquer tema: a cor sobre-primária seria escura no modo escuro e sumiria na foto. É o par fixo do véu, não uma cor da marca (por isso as palavras-chave, e não variáveis) */
#polaris section[data-imagem]{color:white}
#polaris section[data-imagem] a[data-botao=primario]{background:white;color:black}
#polaris section[data-imagem] a[data-botao=secundario]{color:white}
#polaris footer{display:flex;flex-direction:column;gap:calc(var(--espacamento-base) * 2);padding:calc(var(--espacamento-base) * 3) calc(var(--espacamento-base) * 2);background:var(--cor-superficie);border-top:var(--espacamento-borda) solid var(--cor-borda);color:var(--cor-texto-suave)}
#polaris footer a{color:var(--cor-texto-suave)}
#polaris footer a:hover{color:var(--cor-texto)}
#polaris footer nav{flex-direction:column;align-items:flex-start;gap:var(--espacamento-base)}
#polaris hr{border:0;border-top:var(--espacamento-borda) solid var(--cor-borda);width:100%}
#polaris table{border-collapse:collapse;width:100%}
#polaris th,#polaris td{padding:var(--espacamento-base);border-bottom:var(--espacamento-borda) solid var(--cor-borda);text-align:left}
#polaris th{background:var(--cor-superficie-alt);font-weight:600}
#polaris ul,#polaris ol{margin:0 0 var(--espacamento-base);padding-left:calc(var(--espacamento-base) * 3)}
#polaris span[data-tom]{display:inline-block;padding:.1em .7em;border:var(--espacamento-borda) solid currentColor;border-radius:var(--raio-grande);background:var(--cor-superficie);font-size:.85em}
#polaris div[role=alert]{padding:calc(var(--espacamento-base) * 1.5);background:var(--cor-superficie-alt);border:var(--espacamento-borda) solid var(--cor-borda);border-left-width:4px;border-radius:var(--raio-grande)}
#polaris [data-tom=neutro]{color:var(--cor-texto-suave)}
#polaris [data-tom=sucesso]{color:var(--cor-sucesso)}
#polaris [data-tom=alerta]{color:var(--cor-alerta)}
#polaris [data-tom=erro]{color:var(--cor-erro)}
#polaris div[role=alert][data-tom]{color:var(--cor-texto)}
#polaris div[role=alert][data-tom=sucesso]{border-left-color:var(--cor-sucesso)}
#polaris div[role=alert][data-tom=alerta]{border-left-color:var(--cor-alerta)}
#polaris div[role=alert][data-tom=erro]{border-left-color:var(--cor-erro)}
`
