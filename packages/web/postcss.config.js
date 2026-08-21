/**
 * PostCSS — Surakkha web.
 *
 * The two plugins Tailwind needs:
 *   - tailwindcss (consumes tailwind.config.ts)
 *   - autoprefixer (vendor prefixes for the box-shadows and gradients)
 *
 * Story 1.2a wires this file alongside the Tailwind config + index.css.
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
