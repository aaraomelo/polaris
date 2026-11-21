import { ICONES_CSS } from '../icones/css'

// Folha de estilo dos blocos base, escrita SÓ com variáveis do tema (nenhuma cor/medida fixa): trocar o tema ou o modo reestiliza tudo.
// Os blocos emitem tags semânticas (e `data-tom`, `role`), então o estilo se prende a elas dentro do contêiner `#polaris`.
export const BASE_CSS = `/* polaris: estilos base dos blocos (usa só variáveis do tema) */
body{margin:0;background:var(--cor-fundo);color:var(--cor-texto);font-family:var(--tipografia-familia);font-size:var(--tipografia-tamanho-base);line-height:1.5}
#polaris h1,#polaris h2,#polaris h3,#polaris h4,#polaris h5,#polaris h6{margin:0 0 var(--espacamento-base);line-height:var(--tipografia-altura-titulo, 1.25);letter-spacing:var(--tipografia-espacamento-titulo, normal);font-family:var(--tipografia-familia-titulo, var(--tipografia-familia));font-weight:var(--tipografia-peso-titulo, bold)}
#polaris h1{font-size:var(--tipografia-tamanho-h1, 2em)}
#polaris h2{font-size:var(--tipografia-tamanho-h2, 1.5em)}
#polaris h3{font-size:var(--tipografia-tamanho-h3, 1.17em)}
#polaris p{margin:0 0 var(--espacamento-base);line-height:var(--tipografia-altura-corpo, inherit)}
#polaris [data-sobretitulo]{line-height:1.5;margin:0 0 var(--tipografia-margem-sobretitulo, var(--espacamento-base));font-size:var(--tipografia-tamanho-sobretitulo, .75em);font-weight:600;letter-spacing:var(--tipografia-espacamento-sobretitulo, .25em);text-transform:uppercase;color:var(--cor-primaria)}
#polaris section[data-imagem] [data-sobretitulo]{color:inherit;opacity:.85}
#polaris [data-contido]{box-sizing:border-box;width:100%;max-width:var(--layout-largura, 72rem);margin-inline:auto;padding-inline:calc(var(--espacamento-base) * 3)}
#polaris [data-contido=estreita]{max-width:var(--layout-largura-estreita, 48rem)}
#polaris [data-contido=larga]{max-width:var(--layout-largura-larga, 90rem)}
#polaris a{color:var(--cor-primaria)}
#polaris a:hover{color:var(--cor-primaria-hover)}
#polaris :is(a,button){transition:color var(--movimento-rapido, 0s) ease,background-color var(--movimento-rapido, 0s) ease,border-color var(--movimento-rapido, 0s) ease}
#polaris :focus-visible{outline:2px solid var(--cor-destaque);outline-offset:2px}
#polaris button{background:var(--cor-primaria);color:var(--cor-texto-sobre-primaria);border:var(--espacamento-borda) solid transparent;border-radius:var(--raio-pequeno);padding:calc(var(--espacamento-base) * .75) calc(var(--espacamento-base) * 1.5);font:inherit;cursor:pointer}
#polaris button:hover:not(:disabled){background:var(--cor-primaria-hover)}
#polaris button:disabled{opacity:.55;cursor:not-allowed}
#polaris button[data-variante=secundario]{background:transparent;color:var(--cor-texto);border-color:var(--cor-borda)}
#polaris button[data-variante=secundario]:hover:not(:disabled){background:var(--cor-superficie-alt);border-color:var(--cor-primaria)}
#polaris button[data-variante=fantasma]{background:transparent;color:var(--cor-texto)}
#polaris button[data-variante=fantasma]:hover:not(:disabled){background:var(--cor-superficie-alt)}
#polaris input[type=text],#polaris input[type=number],#polaris input[type=email],#polaris input[type=tel],#polaris input[type=url],#polaris input[type=password],#polaris input[type=date],#polaris input[type=time],#polaris input[type=datetime-local],#polaris textarea,#polaris select,#polaris input[type=search]{background:var(--cor-superficie);color:var(--cor-texto);border:var(--espacamento-borda) solid var(--cor-borda);border-radius:var(--raio-pequeno);padding:calc(var(--espacamento-base) * .75);font:inherit}
#polaris form[role=search]{display:flex;align-items:center;gap:var(--espacamento-base);margin:0}
#polaris form[role=search] input[type=search]{min-width:12ch;flex:1}
#polaris form[role=search]{position:relative}
#polaris form[role=search]>ul[data-sugestoes-url]{position:absolute;top:100%;left:0;right:0;z-index:20;margin:calc(var(--espacamento-base) * 0.5) 0 0;padding:calc(var(--espacamento-base) * 0.5);list-style:none;background:var(--cor-superficie);border:var(--espacamento-borda) solid var(--cor-borda);border-radius:var(--raio-pequeno);box-shadow:0 8px 24px color-mix(in srgb, var(--cor-texto) 22%, transparent);max-height:70vh;overflow:auto}
#polaris form[role=search]>ul[data-sugestoes-url][hidden]{display:none}
#polaris ul[data-sugestoes-url]>li>a{display:flex;align-items:center;gap:calc(var(--espacamento-base) * 1.5);padding:calc(var(--espacamento-base) * 0.75);border-radius:var(--raio-pequeno);color:var(--cor-texto);text-decoration:none}
#polaris ul[data-sugestoes-url]>li>a:hover,#polaris ul[data-sugestoes-url]>li[aria-selected=true]>a{background:var(--cor-superficie-alt)}
#polaris ul[data-sugestoes-url]>li[aria-selected=true]>a{outline:2px solid var(--cor-destaque);outline-offset:-2px}
#polaris ul[data-sugestoes-url] img{width:2.5rem;height:2.5rem;flex:none;object-fit:cover;border-radius:var(--raio-pequeno);background:var(--cor-superficie-alt)}
#polaris ul[data-sugestoes-url] [data-s-texto]{display:flex;flex-direction:column;min-width:0}
#polaris ul[data-sugestoes-url] [data-s-titulo]{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#polaris ul[data-sugestoes-url] [data-s-desc]{color:var(--cor-texto-suave);font-size:.875em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#polaris ul[data-sugestoes-url] mark{background:transparent;color:var(--cor-primaria);font-weight:700;text-decoration:underline;text-underline-offset:.15em}
#polaris ul[data-sugestoes-url] [data-s-vazio]{padding:calc(var(--espacamento-base) * 0.75);color:var(--cor-texto-suave)}
#polaris [data-s-status]{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
#polaris input::placeholder{color:var(--cor-texto-suave)}
#polaris input:disabled{opacity:.55}
#polaris input[type=checkbox]{accent-color:var(--cor-primaria);width:1.1em;height:1.1em}
#polaris label{display:inline-block}
#polaris small{color:var(--cor-texto-suave)}
#polaris code{background:var(--cor-superficie-alt);border-radius:var(--raio-pequeno);padding:.1em .4em;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
#polaris header{display:flex;align-items:center;gap:calc(var(--espacamento-base) * 2);padding:var(--espacamento-base) calc(var(--espacamento-base) * 2);box-sizing:border-box;min-height:var(--cabecalho-altura, auto);background:var(--cabecalho-fundo, var(--cor-superficie));border-bottom:var(--espacamento-borda) solid var(--cabecalho-borda, var(--cor-borda));-webkit-backdrop-filter:var(--cabecalho-desfoque, none);backdrop-filter:var(--cabecalho-desfoque, none);transition:background-color var(--movimento-rapido, 0s) ease,border-color var(--movimento-rapido, 0s) ease}
#polaris header[data-fixo]{position:sticky;top:0;z-index:10}
#polaris header>a>:is(h1,h2,h3,h4,h5,h6,strong){margin:0;font-size:var(--cabecalho-marca-tamanho, 1em);font-weight:var(--cabecalho-marca-peso, 700);letter-spacing:var(--cabecalho-marca-espacamento, normal);line-height:inherit}
#polaris header>a>strong{font-family:var(--cabecalho-marca-familia, inherit)}
#polaris header>a{transition:color var(--movimento-rapido, 0s) ease}
#polaris header>a:hover{color:var(--cabecalho-marca-hover, var(--cor-primaria-hover))}
#polaris header>a{display:flex;align-items:center;gap:var(--espacamento-base);color:var(--cor-texto);text-decoration:none}
#polaris nav{display:flex;flex-wrap:wrap;align-items:center;gap:calc(var(--espacamento-base) * 2)}
#polaris header>nav{flex:1}
#polaris header[data-centro]>nav{justify-content:center}
#polaris header nav a,#polaris header nav summary{position:relative;font-size:var(--cabecalho-link-tamanho, inherit);letter-spacing:var(--cabecalho-link-espacamento, normal);text-transform:var(--cabecalho-link-caixa, none);transition:color var(--movimento-rapido, 0s) ease}
#polaris header nav a{color:var(--cabecalho-link-cor, var(--cor-primaria))}
#polaris header nav a:hover{color:var(--cabecalho-link-hover, var(--cor-primaria-hover))}
#polaris header nav a::after{content:'';position:absolute;left:0;right:0;bottom:-.25em;height:1px;background:currentColor;transform:scaleX(0);transform-origin:left;transition:transform var(--movimento-sublinha, 0s) cubic-bezier(0,0,.2,1)}
#polaris header nav a:hover::after,#polaris header nav a[aria-current=page]::after{transform:scaleX(var(--cabecalho-sublinha-hover, 0))}
#polaris [data-painel]{display:grid;grid-template-columns:var(--largura-lateral, 16rem) minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);height:100vh;overflow:hidden}
#polaris [data-painel]>header{grid-column:1/-1;grid-row:1}
#polaris [data-painel]>aside[data-lateral]{grid-column:1;grid-row:2;overflow:auto;border-right:var(--espacamento-borda) solid var(--cor-borda);background:var(--cor-superficie);padding:calc(var(--espacamento-base) * 1.5);display:flex;flex-direction:column;gap:calc(var(--espacamento-base) * 1.5)}
#polaris [data-painel]>main[data-principal]{grid-column:2;grid-row:2;overflow:auto;padding:calc(var(--espacamento-base) * 2);min-width:0}
#polaris [data-lateral] nav{flex-direction:column;flex-wrap:nowrap;align-items:stretch;gap:2px}
#polaris [data-lateral] nav>div{display:flex;flex-direction:column;gap:2px;margin-bottom:calc(var(--espacamento-base) * 1.5)}
#polaris [data-lateral] nav small,#polaris [data-lateral] nav p{margin:calc(var(--espacamento-base) * 1) 0 calc(var(--espacamento-base) * 0.5);padding:0 calc(var(--espacamento-base) * 1);text-transform:uppercase;letter-spacing:.06em;font-size:.75em;font-weight:700;color:var(--cor-texto-suave)}
#polaris [data-lateral] nav a,#polaris [data-lateral] nav button{display:flex;align-items:center;gap:calc(var(--espacamento-base) * 1.25);overflow-wrap:anywhere;width:100%;text-align:left;background:transparent;color:var(--cor-texto);border:0;border-left:3px solid transparent;border-radius:var(--raio-pequeno);padding:calc(var(--espacamento-base) * 0.75) calc(var(--espacamento-base) * 1.25);font:inherit;text-decoration:none;cursor:pointer}
#polaris [data-lateral] nav :is(a,button)[data-icone]::before{color:var(--cor-texto-suave)}
#polaris [data-lateral] nav :is(a,button)[aria-current][data-icone]::before{color:var(--cor-primaria)}
#polaris [data-lateral] nav a:hover,#polaris [data-lateral] nav button:hover:not(:disabled){background:var(--cor-superficie-alt);color:var(--cor-texto)}
#polaris [data-lateral] nav a[aria-current],#polaris [data-lateral] nav button[aria-current]{background:var(--cor-superficie-alt);border-left-color:var(--cor-primaria);font-weight:600}
#polaris [data-lateral] nav a:focus-visible,#polaris [data-lateral] nav button:focus-visible{outline:2px solid var(--cor-destaque);outline-offset:-2px}
#polaris [data-lateral]>input[data-alternador]{position:absolute;opacity:0;width:1px;height:1px;margin:0}
#polaris [data-lateral]>label[for]{display:none;cursor:pointer;padding:calc(var(--espacamento-base) * 0.75) calc(var(--espacamento-base) * 1.5);border:var(--espacamento-borda) solid var(--cor-borda);border-radius:var(--raio-pequeno);user-select:none}
#polaris [data-lateral]>input[data-alternador]:focus-visible+label[for]{outline:2px solid var(--cor-destaque);outline-offset:2px}
@media (max-width:40rem){
#polaris [data-painel]{display:flex;flex-direction:column;height:auto;overflow:visible;min-height:100vh}
#polaris [data-painel]>aside[data-lateral]{border-right:0;border-bottom:var(--espacamento-borda) solid var(--cor-borda);overflow:visible}
#polaris [data-painel]>main[data-principal]{overflow:visible;padding:calc(var(--espacamento-base) * 1.5)}
#polaris [data-lateral]>label[for]{display:inline-block}
#polaris [data-lateral]>input[data-alternador]:not(:checked)~*:not(label){display:none}
}
#polaris [data-cartao]{display:flex;flex-direction:column;gap:var(--espacamento-base);min-width:0;padding:calc(var(--espacamento-base) * 2);background:var(--cor-superficie);border:var(--espacamento-borda) solid var(--cor-borda);border-radius:var(--raio-grande)}
#polaris [data-cartao]>*{margin:0}
#polaris details[data-secao]{border:var(--espacamento-borda) solid var(--cor-borda);border-radius:var(--raio-grande);background:var(--cor-superficie)}
#polaris details[data-secao]>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:calc(var(--espacamento-base) * 1.25);padding:calc(var(--espacamento-base) * 1.25) calc(var(--espacamento-base) * 2);font-weight:600;user-select:none;border-radius:var(--raio-grande)}
#polaris details[data-secao]>summary::-webkit-details-marker{display:none}
#polaris details[data-secao]>summary::after{content:"";margin-left:auto;border:0.3em solid transparent;border-top-color:currentColor;border-bottom-width:0;flex:none}
#polaris details[data-secao][open]>summary::after{transform:rotate(180deg)}
#polaris details[data-secao]>summary:hover{background:var(--cor-superficie-alt)}
#polaris details[data-secao]>summary:focus-visible{outline:2px solid var(--cor-destaque);outline-offset:-2px}
#polaris details[data-secao]>summary[data-icone]::before{color:var(--cor-primaria)}
#polaris details[data-secao][open]>summary{border-bottom:var(--espacamento-borda) solid var(--cor-borda);border-bottom-left-radius:0;border-bottom-right-radius:0}
#polaris details[data-secao]>:not(summary){margin:calc(var(--espacamento-base) * 1.5) calc(var(--espacamento-base) * 2)}
#polaris nav>details[data-submenu]{position:relative}
#polaris nav>details[data-submenu]>summary{cursor:pointer;list-style:none;color:var(--cor-texto);user-select:none}
#polaris nav>details[data-submenu]>summary::-webkit-details-marker{display:none}
#polaris nav>details[data-submenu]>summary::after{content:"";display:inline-block;margin-left:calc(var(--espacamento-base) * 0.5);border:0.3em solid transparent;border-top-color:currentColor;border-bottom-width:0;vertical-align:middle}
#polaris nav>details[data-submenu][open]>summary::after{transform:rotate(180deg)}
#polaris nav>details[data-submenu]>summary:focus-visible{outline:2px solid var(--cor-destaque);outline-offset:2px}
#polaris nav>details[data-submenu]>a{display:block;padding:calc(var(--espacamento-base) * 0.75) 0}
@supports selector(::details-content){
#polaris header nav>details[data-submenu]:not([open])::details-content{display:none}
#polaris header nav>details[data-submenu][open]::details-content{position:absolute;top:100%;left:0;z-index:10;min-width:12rem;padding:var(--espacamento-base) calc(var(--espacamento-base) * 2);background:var(--cor-superficie);border:var(--espacamento-borda) solid var(--cor-borda);border-radius:var(--raio-pequeno)}
}
@media (max-width:40rem){
#polaris header nav>details[data-submenu][open]::details-content{position:static;min-width:0;padding:0 0 0 calc(var(--espacamento-base) * 2);border:0;background:transparent}
}
#polaris header>input[data-alternador]{position:absolute;opacity:0;width:1px;height:1px;margin:0}
#polaris header>label[for]{display:none;cursor:pointer;margin-left:auto;padding:calc(var(--espacamento-base) * 0.75) calc(var(--espacamento-base) * 1.5);border:var(--espacamento-borda) solid var(--cor-borda);border-radius:var(--raio-pequeno);user-select:none}
#polaris header>input[data-alternador]:focus-visible+label[for]{outline:2px solid var(--cor-destaque);outline-offset:2px}
@media (max-width:40rem){
#polaris header{flex-wrap:wrap}
#polaris header>label[for]{display:inline-block}
#polaris header>input[data-alternador]:not(:checked)~*:not(label){display:none}
#polaris header>input[data-alternador]:checked~*:not(label){flex:1 0 100%;flex-direction:column;align-items:flex-start}
#polaris header>input[data-alternador]:checked~nav{display:flex}
#polaris header>input[data-alternador]:checked~form{display:flex;width:100%}
}
#polaris nav a{text-decoration:none}
#polaris nav a[aria-current=page]{color:var(--cor-texto);font-weight:600;text-decoration:underline}
#polaris section[data-alinha]{display:flex;flex-direction:column;justify-content:center;gap:calc(var(--espacamento-base) * 2);padding:calc(var(--espacamento-base) * 6) calc(var(--espacamento-base) * 3);background-size:cover;background-position:center;border-radius:var(--raio-grande)}
#polaris section[data-capa]{box-sizing:border-box;position:relative;overflow:hidden;justify-content:flex-end;border-radius:0;margin-top:calc(var(--cabecalho-altura, 0px) * -1);padding-top:calc(var(--cabecalho-altura, 0px) + var(--espacamento-base) * 6);padding-inline:0;padding-bottom:calc(var(--espacamento-base) * 14)}
#polaris section[data-capa]>*{position:relative;z-index:1}
#polaris section[data-capa][data-imagem]::before{content:'';position:absolute;inset:0;z-index:0;background:inherit;background-size:cover;background-position:center}
@media (prefers-reduced-motion:no-preference){
#polaris section[data-capa][data-imagem]::before{animation:pl-zoom-capa var(--movimento-zoom-capa-duracao, 20s) ease-out forwards}
#polaris section[data-capa] [data-contido]>*,#polaris section[data-capa]>*:not([data-contido]){animation:pl-entra var(--movimento-entrada, 0s) ease-out both}
#polaris section[data-capa] [data-contido]>:nth-child(2){animation-delay:.1s}
#polaris section[data-capa] [data-contido]>:nth-child(3){animation-delay:.2s}
#polaris section[data-capa] [data-contido]>:nth-child(4){animation-delay:.3s}
}
@keyframes pl-zoom-capa{from{transform:scale(1)}to{transform:scale(var(--movimento-zoom-capa, 1))}}
@keyframes pl-entra{from{opacity:0;transform:translateY(1rem)}to{opacity:1;transform:none}}
#polaris section[data-capa] h1{font-size:var(--tipografia-tamanho-exibicao, var(--tipografia-tamanho-h1, 2em));line-height:var(--tipografia-altura-exibicao, 1.25);letter-spacing:var(--tipografia-espacamento-exibicao, normal)}
#polaris section[data-fundo=primaria]{background-color:var(--cor-primaria);color:var(--cor-texto-sobre-primaria)}
#polaris section[data-fundo=suave]{background-color:var(--cor-superficie-alt);color:var(--cor-texto)}
#polaris section[data-alinha=centro]{align-items:center;text-align:center}
#polaris section[data-alinha=esquerda]{align-items:flex-start;text-align:left}
#polaris section[data-alinha] h1,#polaris section[data-alinha] h2,#polaris section[data-alinha] p{margin:0}
#polaris section[data-alinha] a:not([data-botao]){color:inherit}
#polaris a[data-botao]{display:inline-block;padding:calc(var(--espacamento-base) * 1.25) calc(var(--espacamento-base) * 2.5);border:var(--espacamento-borda) solid transparent;border-radius:var(--raio-pequeno);font-weight:var(--botao-peso, 600);font-size:var(--botao-tamanho, inherit);letter-spacing:var(--botao-espacamento, normal);text-transform:var(--botao-caixa, none);text-decoration:none}
#polaris a[data-botao=primario]{background:var(--cor-primaria);color:var(--cor-texto-sobre-primaria)}
#polaris a[data-botao=primario]:hover{background:var(--cor-primaria-hover);color:var(--cor-texto-sobre-primaria)}
#polaris a[data-botao=secundario]{background:transparent;color:var(--cor-primaria);border-color:currentColor}
#polaris a[data-botao][aria-current]{background:var(--cor-primaria);border-color:var(--cor-primaria);color:var(--cor-texto-sobre-primaria)}
#polaris section[data-capa][data-fundo] a[data-botao=primario]{background:var(--cor-primaria);color:var(--cor-texto-sobre-primaria)}
#polaris section[data-capa][data-fundo] a[data-botao=primario]:hover{background:var(--cor-primaria-hover);color:var(--cor-texto-sobre-primaria)}
#polaris section[data-fundo=primaria] a[data-botao=primario]{background:var(--cor-texto-sobre-primaria);color:var(--cor-primaria)}
#polaris section[data-fundo=primaria] a[data-botao=secundario]{color:var(--cor-texto-sobre-primaria)}
/* com imagem de fundo o véu (scrim) é SEMPRE preto, então o texto é branco em qualquer tema: a cor sobre-primária seria escura no modo escuro e sumiria na foto. É o par fixo do véu, não uma cor da marca (por isso as palavras-chave, e não variáveis) */
#polaris section[data-imagem]{color:white}
#polaris section[data-imagem] a[data-botao=primario]{background:white;color:black}
#polaris section[data-imagem] a[data-botao=secundario]{color:white}
#polaris footer{display:flex;flex-direction:column;gap:calc(var(--espacamento-base) * 2);padding:calc(var(--espacamento-base) * 3) calc(var(--espacamento-base) * 2);background:var(--rodape-fundo, var(--cor-superficie));border-top:var(--espacamento-borda) solid var(--rodape-borda, var(--cor-borda));color:var(--rodape-texto, var(--cor-texto-suave))}
#polaris footer a{color:var(--rodape-link, var(--cor-texto-suave));transition:color var(--movimento-rapido, 0s) ease}
#polaris footer a:hover{color:var(--rodape-texto, var(--cor-texto))}
#polaris footer :is(h1,h2,h3,h4,h5,h6){color:var(--rodape-texto, inherit);font-size:var(--rodape-marca-tamanho, inherit)}
#polaris a:has(>[data-recorta]){display:block}
#polaris [data-recorta]{overflow:hidden}
#polaris [data-marca=foto-produto]{position:relative}
#polaris [data-marca=foto-produto]>img:first-of-type{transition:transform var(--movimento-zoom-duracao, 0s) ease-out,opacity var(--movimento-foto-alt, 0s) ease-out}
#polaris [data-marca=foto-produto]>img:nth-of-type(2){position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transform:scale(var(--movimento-zoom-cartao, 1));transition:opacity var(--movimento-foto-alt, 0s) ease-out,transform var(--movimento-foto-alt, 0s) ease-out}
#polaris [data-marca=foto-produto]:hover>img:nth-of-type(2){opacity:1;transform:none}
#polaris [data-marca=foto-produto]:has(>img:nth-of-type(2)):hover>img:first-of-type{opacity:0}
#polaris [data-marca=selo-produto]{position:absolute;top:var(--cartao-selo-margem, 1rem);left:var(--cartao-selo-margem, 1rem);z-index:1;padding:.375rem .75rem;background:var(--cartao-selo-fundo, var(--cor-primaria));color:var(--cartao-selo-texto, var(--cor-texto-sobre-primaria));pointer-events:none}
#polaris [data-marca=selo-produto]>small{color:var(--cartao-selo-texto, var(--cor-texto-sobre-primaria));font-size:.625rem;font-weight:600;letter-spacing:.2em;text-transform:uppercase}
#polaris [data-marca=rotulo-produto]{position:absolute;left:50%;bottom:1rem;z-index:1;padding:.625rem 1.5rem;background:color-mix(in srgb, var(--cor-fundo) 95%, transparent);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);white-space:nowrap;pointer-events:none;opacity:0;transform:translate(-50%,.5rem);transition:opacity var(--movimento-rotulo, 0s) ease,transform var(--movimento-rotulo, 0s) ease}
#polaris [data-marca=foto-produto]:hover>[data-marca=rotulo-produto]{opacity:1;transform:translate(-50%,0)}
#polaris [data-marca=rotulo-produto]>small{font-size:.75rem;font-weight:500;letter-spacing:.15em;text-transform:uppercase;color:var(--cor-texto)}
#polaris [data-marca=cartao-produto] [data-sobretitulo]{margin:0;color:var(--cartao-categoria-cor, var(--cor-texto-suave));font-size:var(--cartao-categoria-tamanho, .6875rem);letter-spacing:var(--cartao-categoria-espacamento, .2em);font-weight:500}
#polaris [data-marca=cartao-produto] h3{margin:0;line-height:var(--cartao-titulo-altura, var(--tipografia-altura-titulo, 1.25));font-size:var(--cartao-titulo-tamanho, var(--tipografia-tamanho-h3, 1.17em));letter-spacing:var(--cartao-titulo-espacamento, normal);transition:color var(--movimento-rapido, 0s) ease}
#polaris [data-marca=cartao-produto]:hover h3{color:var(--cartao-titulo-hover, inherit)}
#polaris [data-marca=cartao-produto]>small{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden;font-size:var(--cartao-descricao-tamanho, .875em);line-height:var(--tipografia-altura-corpo, inherit);color:var(--cor-texto-suave)}
#polaris [data-marca=cartao-produto] strong{font-size:var(--cartao-preco-tamanho, inherit);font-weight:var(--cartao-preco-peso, bolder);letter-spacing:var(--cartao-preco-espacamento, normal)}
#polaris section[data-zoom][data-imagem]{position:relative;overflow:hidden}
#polaris section[data-zoom][data-imagem]::before{content:'';position:absolute;inset:0;z-index:0;background:inherit;background-size:cover;background-position:center;transition:transform var(--movimento-zoom-faixa-duracao, 0s) ease-out}
#polaris section[data-zoom][data-imagem]:hover::before{transform:scale(var(--movimento-zoom-faixa, 1))}
#polaris section[data-zoom][data-imagem]::after{content:'';position:absolute;inset:0;z-index:0;background:var(--movimento-faixa-veu, transparent);opacity:0;transition:opacity var(--movimento-faixa-veu-duracao, 0s) ease}
#polaris section[data-zoom][data-imagem]:hover::after{opacity:1}
#polaris section[data-zoom]>*{position:relative;z-index:1}
#polaris section[data-zoom]{justify-content:flex-end;padding:calc(var(--espacamento-base) * 4)}
#polaris section[data-zoom] :is(h2,h3){transition:transform var(--movimento-faixa-texto, 0s) ease}
#polaris section[data-zoom]:hover :is(h2,h3){transform:translateY(var(--movimento-faixa-elevacao, 0px))}
#polaris [data-recorta]>img{transition:transform var(--movimento-zoom-duracao, 0s) ease-out}
#polaris [data-recorta]:hover>img{transform:scale(var(--movimento-zoom-cartao, 1))}
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
${ICONES_CSS}
`
