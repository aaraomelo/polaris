// Runtime WebGL2 do kernel (navegador). SEM imports: este arquivo é empacotado sozinho no cliente. Recebe o `PipelineGl` (JSON) e entradas JÁ preparadas
// (Float32Array/Int32Array/escalares numéricos; ver `preparaEntradas`), executa um passe de fragmento e lê o resultado com readPixels.
type PipeTipo = 'i32' | 'f32' | 'bool'
export type PipelineGl = { vs: string; fs: string; escalares: Array<{ nome: string; tipo: PipeTipo }>; vetores: Array<{ nome: string; tipo: PipeTipo }>; saidas: Array<{ nome: string; tipo: PipeTipo }> }
export type EntradasGl = { escalares: Record<string, number>; vetores: Record<string, ArrayLike<number>> }

/** contexto WebGL2 com render em float, ou `null` (sem GPU, sem a extensão, contexto perdido): quem chama cai para wasm/js */
export function contextoGl(canvas: { getContext(id: string, o?: object): unknown }): WebGL2RenderingContext | null {
  try { const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null; if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null; return gl } catch { return null }
}

export function executaGl(gl: WebGL2RenderingContext, pipe: PipelineGl, e: EntradasGl, n: number): Record<string, Float32Array | Int32Array> {
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  const W = Math.max(1, Math.ceil(Math.sqrt(n))), H = Math.max(1, Math.ceil(n / W))
  if (W > max || H > max) throw new Error(`n=${n} não cabe numa textura de ${max}×${max}`)
  const limpa: Array<() => void> = []
  try {
    const sh = (tipo: number, fonte: string) => { const s = gl.createShader(tipo)!; gl.shaderSource(s, fonte); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`); limpa.push(() => gl.deleteShader(s)); return s }
    const prog = gl.createProgram()!; limpa.push(() => gl.deleteProgram(prog))
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, pipe.vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, pipe.fs)); gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog)}`)
    gl.useProgram(prog)
    gl.uniform1i(gl.getUniformLocation(prog, 'uN'), n); gl.uniform1i(gl.getUniformLocation(prog, 'uW'), W)
    for (const p of pipe.escalares) { const loc = gl.getUniformLocation(prog, `s_${p.nome}`), v = e.escalares[p.nome]!; if (p.tipo === 'f32') gl.uniform1f(loc, v); else gl.uniform1i(loc, v) }
    pipe.vetores.forEach((p, unit) => {
      const tex = gl.createTexture()!; limpa.push(() => gl.deleteTexture(tex))
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      const dados = new Float32Array(W * H); dados.set(e.vetores[p.nome]!) // int e bool viajam como float (exatos até 2^24)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, W, H, 0, gl.RED, gl.FLOAT, dados)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.uniform1i(gl.getUniformLocation(prog, `t_${p.nome}`), unit)
    })
    const alvo = gl.createTexture()!; limpa.push(() => gl.deleteTexture(alvo))
    gl.activeTexture(gl.TEXTURE0 + pipe.vetores.length); gl.bindTexture(gl.TEXTURE_2D, alvo)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    const fb = gl.createFramebuffer()!; limpa.push(() => gl.deleteFramebuffer(fb))
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, alvo, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer float incompleto (sem render em RGBA32F)')
    gl.viewport(0, 0, W, H); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST)
    const vao = gl.createVertexArray()!; limpa.push(() => gl.deleteVertexArray(vao)); gl.bindVertexArray(vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    const px = new Float32Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, px)
    const err = gl.getError(); if (err !== gl.NO_ERROR) throw new Error(`erro WebGL ${err}`)
    const out: Record<string, Float32Array | Int32Array> = {}
    pipe.saidas.forEach((s, ch) => {
      const a = s.tipo === 'f32' ? new Float32Array(n) : new Int32Array(n)
      for (let i = 0; i < n; i++) a[i] = s.tipo === 'f32' ? px[i * 4 + ch]! : s.tipo === 'bool' ? (px[i * 4 + ch]! !== 0 ? 1 : 0) : Math.round(px[i * 4 + ch]!)
      out[s.nome] = a
    })
    return out
  } finally { for (const f of limpa.reverse()) f(); gl.bindFramebuffer(gl.FRAMEBUFFER, null) }
}
