# ΚΟΣΜΟΣ — Q-Law Orbital Transfer

An interactive, browser-based low-thrust orbital transfer demonstrator. The guidance and propagation core is written in AssemblyScript and compiled to WebAssembly; the visualization is dependency-free WebGL.

## Features

- Classical-element Petropoulos Q-law proximity quotient
- Full numerical gradient of Q and Gauss variational-equation steering
- Periapsis penalty, semi-major-axis scaling, and relative-effectivity coasting
- Variable spacecraft mass with constant thrust and specific impulse
- Interactive origin, destination, spacecraft, and Q-law weights
- Real NASA Blue Marble Earth texture with ocean specular response and atmospheric lighting
- Transfer animation and optional impulsive Hohmann/plane-change comparison
- Responsive desktop and mobile layout

## Scientific scope

ΚΟΣΜΟΣ is a preliminary-design and educational tool, not flight software. It models an Earth-centred two-body problem and propagates classical orbital elements with a fixed 60-second Euler step. The controller uses

```text
Q = (1 + Wp P) Σ Wi Si [(oei − oei,target) / max(|d(oei)/dt|)]²
```

and chooses the thrust direction along the steepest instantaneous descent of Q. The implementation follows the classical-element formulation used by [pyqlaw](https://github.com/Yuricst/pyqlaw), including Petropoulos scaling and effectivity coasting.

Important limitations:

- Classical elements are singular as eccentricity or inclination approaches zero. Numerical floors prevent division by zero but do not remove the singularities.
- The gradient of Q is evaluated with finite differences, and effectivity uses an eight-point true-anomaly grid.
- Dynamics omit J2, drag, third bodies, eclipses, duty cycles, thrust errors, and navigation uncertainty.
- The impulsive comparison assumes circular endpoint radii and uses a fixed 220-second chemical-engine Isp.
- Results have smoke-test coverage but have not been benchmarked against an independently validated trajectory set.

Do not use generated trajectories for operational mission design without independent validation in a high-fidelity tool.

## Local development

Requirements: Node.js 20 or newer.

```bash
npm install
npm test
npm start
```

Open the local URL printed by `serve`. WebAssembly must be loaded over HTTP rather than directly from `file://`.

## Build

Build the WASM module:

```bash
npm run asbuild:release
```

Create a self-contained GitHub Pages bundle in `dist/`:

```bash
npm run build:site
```

The site bundle contains:

```text
dist/
├── build/release.wasm
├── index.html
├── qlaw-wasm.js
└── README.md
```

## GitHub Pages

1. Run `npm run build:site` and commit the generated `dist/` files.
2. In repository **Settings → Pages**, choose **Deploy from a branch**.
3. Select the deployment branch and `/dist` folder, or publish `dist/` through a GitHub Actions workflow.

All application paths are relative, so project pages under `username.github.io/repository/` are supported. The Earth imagery is loaded at runtime from a pinned jsDelivr CDN URL and therefore requires network access.

## Earth imagery

The globe uses NASA Blue Marble imagery, credited to NASA Earth Observatory, served from the pinned `three-globe@2.31.1` asset on jsDelivr. The shader adds lighting and atmosphere only; it does not procedurally generate land, oceans, or clouds.

## WASM is not source protection

WebAssembly improves runtime portability and performance; it does not encrypt the algorithm. The module can be inspected or decompiled. Keep proprietary logic on a trusted server if confidentiality is required.

## References

- J. E. Petropoulos, *Low-Thrust Orbit Transfers Using Candidate Lyapunov Functions with a Mechanism for Coasting*.
- [Low-Thrust Trajectories: An Overview of the Q-law and Other Analytic Techniques](https://www.missionanalysis.org/campagnola/OCSMD/Lec2_Qlaw_Petropoulos.pdf)
- [pyqlaw reference implementation](https://github.com/Yuricst/pyqlaw)

## License

MIT. See [LICENSE](LICENSE).
