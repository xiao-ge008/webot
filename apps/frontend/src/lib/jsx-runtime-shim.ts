import * as jsxRuntime from 'react/jsx-runtime';
import * as jsxDevRuntime from 'react/jsx-dev-runtime';

// Handle both direct and nested default exports from Vite pre-bundled deps
const runtime = (jsxRuntime as any).default || jsxRuntime;
const devRuntime = (jsxDevRuntime as any).default || jsxDevRuntime;

export const jsx = runtime.jsx;
export const jsxs = runtime.jsxs;
export const jsxDEV = devRuntime.jsxDEV;
export const Fragment = runtime.Fragment;

export default {
    jsx,
    jsxs,
    jsxDEV,
    Fragment
};
