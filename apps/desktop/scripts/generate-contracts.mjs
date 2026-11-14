import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { build } from 'vite';

const banner = '// 自动生成；请修改 Python 公共契约后重新生成，不要手工编辑。\n';

function withoutDiscriminator(value) {
  if (Array.isArray(value)) return value.map(withoutDiscriminator);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'discriminator').map(([key, child]) => [key, withoutDiscriminator(child)]));
  return value;
}

export async function generateContracts(document) {
  if (document.schema_version !== 2) throw new Error('不支持的公共 Schema 版本');
  const ajv = new Ajv2020({ code: { source: true, esm: true }, strict: true, inlineRefs: false,
    coerceTypes: false, useDefaults: false, removeAdditional: false });
  addFormats(ajv);
  const namespaces = [];
  const exports = {};
  const declarations = [];
  for (const [name, root] of Object.entries(document.roots)) {
    const schema = withoutDiscriminator(root.schema);
    const generated = await compile({ ...schema, title: name }, name, { bannerComment: '',
      style: { singleQuote: true }, $refOptions: { resolve: { http: false, file: false } } });
    namespaces.push(`export namespace ${name}Schema {\n${generated.split('\n').map(line => line ? '  ' + line : '').join('\n')}\n}\nexport type ${name} = ${name}Schema.${name};\n`);
    const schemaId = `urn:flowmate:public:${name}`;
    ajv.addSchema({ ...schema, $id: schemaId });
    exports[name] = schemaId;
    declarations.push(`export declare function ${name}(value: unknown): value is ${name};`);
  }
  // 使用已有 Vite 在构建期打包 Ajv 的格式/Unicode helper；WebView 只加载纯 ESM 验证函数。
  const entry = fileURLToPath(new URL('__standalone-validators__.mjs', import.meta.url));
  const source = standaloneCode(ajv, exports);
  const [bundle] = await build({ configFile: false, logLevel: 'silent',
    plugins: [{ name: 'flowmate-standalone', resolveId(id) { if (id === entry) return entry; }, load(id) { if (id === entry) return source; } }],
    build: { write: false, minify: false, lib: { entry, formats: ['es'] } },
  });
  return {
    'contracts.ts': banner + namespaces.join('\n'),
    'validators.js': banner + bundle.output[0].code,
    'validators.d.ts': banner + `import type { ${Object.keys(exports).join(', ')} } from './contracts';\n` + declarations.join('\n') + '\n',
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = new URL('../src/generated/', import.meta.url);
  const document = JSON.parse(await readFile(new URL('contracts.schema.json', directory), 'utf8'));
  const generated = await generateContracts(document);
  const check = process.argv.includes('--check');
  for (const [name, content] of Object.entries(generated)) {
    const target = new URL(name, directory);
    if (check) {
      const current = await readFile(target, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (current !== content) throw new Error(`公共契约生成漂移: ${name}；请运行 npm run contracts:generate`);
    } else await writeFile(target, content, 'utf8');
  }
  console.log(check ? '公共契约无漂移' : '公共契约已生成');
}
