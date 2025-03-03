import { paraglide } from "@inlang/paraglide-next/plugin";

export default paraglide({
  paraglide: {
    project: "./project.inlang",
    outdir: "./src/paraglide",
  },

  basePath: "/base",
  output: "standalone",
  experimental: {
    typedRoutes: true,
  },
});
