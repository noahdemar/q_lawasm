// WASM Loader for Q-Law module
// This handles loading and interfacing with the WASM binary

const QLawWASM = {
    instance: null,
    ready: false,

    async load(wasmPath = 'build/release.wasm') {
        try {
            const response = await fetch(wasmPath);
            if (!response.ok) throw new Error(`WASM request failed (${response.status})`);
            const imports = {
                env: {
                    abort: (msg, file, line, col) => {
                        console.error(`WASM abort at ${line}:${col}`);
                    }
                }
            };
            let result;
            try {
                result = await WebAssembly.instantiateStreaming(response.clone(), imports);
            } catch {
                result = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
            }

            this.instance = result.instance.exports;
            this.ready = true;
            console.log('Q-Law WASM module loaded');
            return true;
        } catch (e) {
            console.error('Failed to load WASM:', e);
            return false;
        }
    },

    init(thrust, mass, isp, targetA, targetE, targetI, targetW, targetw,
         weightA, weightE, weightI, weightW, weightw, dt, tMax) {
        if (!this.ready) return false;
        this.instance.init(thrust, mass, isp, targetA, targetE, targetI, targetW, targetw,
                          weightA, weightE, weightI, weightW, weightw, dt, tMax);
        return true;
    },

    run(a0, e0, i0, W0, w0, f0) {
        if (!this.ready) return null;
        const count = this.instance.run(a0, e0, i0, W0, w0, f0);

        // Extract trajectory
        const traj = [];
        for (let i = 0; i < count; i++) {
            traj.push({
                t: this.instance.getTrajT(i),
                oe: [
                    this.instance.getTrajA(i),
                    this.instance.getTrajE(i),
                    this.instance.getTrajI(i),
                    this.instance.getTrajW(i),
                    this.instance.getTrajw(i),
                    this.instance.getTrajF(i)
                ],
                r: [
                    this.instance.getTrajRx(i),
                    this.instance.getTrajRy(i),
                    this.instance.getTrajRz(i)
                ],
                m: this.instance.getTrajM(i),
                dv: this.instance.getTrajDv(i)
            });
        }

        return {
            traj,
            t: this.instance.getResultT(),
            dv: this.instance.getResultDv(),
            fuel: this.instance.getResultFuel(),
            revs: this.instance.getResultRevs(),
            ok: this.instance.getResultOk() === 1
        };
    },

    calcImpulsiveDv(a1, a2, i1, i2) {
        if (!this.ready) return 0;
        return this.instance.calcImpulsiveDv(a1, a2, i1, i2);
    }
};
