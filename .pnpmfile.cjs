// openapi-typescript needs the TypeScript JS compiler API, which TypeScript 7
// (the native compiler) no longer ships. Give it its own TypeScript 6 until it
// supports TypeScript 7.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "openapi-typescript") {
        delete pkg.peerDependencies?.typescript;
        pkg.dependencies = { ...pkg.dependencies, typescript: "6.0.3" };
      }
      return pkg;
    },
  },
};
