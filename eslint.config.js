import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/.vite/**",
      "**/*.snap",
      "data/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // 项目既有约定:用 `_` 前缀标记"故意不用"的解构占位(如 `const { chain_via: _omit, ...rest }`、
      // `const [server, port, _protocol] = parts`)。tsc 的 noUnusedLocals 认这个前缀,lint 也得认。
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // shadcn/ui 生成的组件习惯写 `interface InputProps extends React.InputHTMLAttributes<...> {}`,
      // 空接口在这里是有意的扩展点,不是错误。
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "with-single-extends" },
      ],
    },
  },

  // 类型感知规则代价高,只对进了 tsconfig 的源码开;backend/tsconfig.json 显式 exclude 了 tests,
  // 给 tests 和构建脚本开会直接解析报错。
  //
  // 这里刻意不上 recommendedTypeChecked 全家桶 —— js-yaml 的 load() 返回 any,no-unsafe-* 会在
  // parsers / storage 里刷成百上千条噪音,反而淹掉真问题。只挑 tsc 覆盖不到、又最容易在这个项目里
  // 咬人的一类:没人管的 promise(后端漏 await 会变成静默失败的文件写入 / provider 拉取)。
  {
    files: ["backend/src/**/*.ts", "frontend/src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: ["./backend/tsconfig.json", "./frontend/tsconfig.app.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      // React 事件属性写 `onClick={async () => ...}` 是常规写法,这类 void 返回位置不检查;
      // 其余位置(比如把 async 函数传给期望同步回调的 API)仍然拦。
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
);
