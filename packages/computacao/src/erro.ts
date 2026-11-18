export class KernelErro extends Error { constructor(m: string, readonly onde?: string) { super(onde ? `${onde}: ${m}` : m); this.name = 'KernelErro' } }
