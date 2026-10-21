// 使用项目已有的 TypeScript AST，只检查运行时本地依赖；类型引用不算运行时循环。
import ts from '../app/node_modules/typescript/lib/typescript.js';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {dirname,resolve,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../app/src');
const paths=[];
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const p=resolve(dir,entry.name);if(entry.isDirectory())walk(p);else if(/\.tsx?$/.test(p)&&!p.endsWith('.d.ts')&&!p.includes('.test.'))paths.push(p)}}
walk(root);
const graph=new Map(paths.map(p=>[p,new Set()])),violations=[];
for(const p of paths){
 const file=ts.createSourceFile(p,readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true,extname(p)==='.tsx'?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 for(const node of file.statements){
  if(!ts.isImportDeclaration(node)&&!ts.isExportDeclaration(node))continue;
  if(!node.moduleSpecifier||!ts.isStringLiteral(node.moduleSpecifier))continue;
  if(ts.isImportDeclaration(node)){
   if(node.importClause?.isTypeOnly)continue;
   const clause=node.importClause,bindings=clause?.namedBindings;
   if(clause&&!clause.name&&bindings&&ts.isNamedImports(bindings)&&bindings.elements.every(e=>e.isTypeOnly))continue;
  }else if(node.isTypeOnly)continue;
  const name=node.moduleSpecifier.text;if(!name.startsWith('.'))continue;
  const stem=resolve(dirname(p),name),target=[stem+'.ts',stem+'.tsx',resolve(stem,'index.ts'),resolve(stem,'index.tsx')].find(existsSync);
  if(target&&graph.has(target)){graph.get(p).add(target);if(p.startsWith(resolve(root,'domain')+'/')&&/\/(ui|state|shell)\//.test(target))violations.push(relative(root,p)+' → '+relative(root,target))}
 }
}
const active=[],done=new Set(),cycles=new Set();
function visit(p){if(active.includes(p)){cycles.add(active.slice(active.indexOf(p)).map(p=>relative(root,p)).sort().join(' → '));return}if(done.has(p))return;active.push(p);for(const c of graph.get(p))visit(c);active.pop();done.add(p)}
for(const p of paths)visit(p);
console.log(JSON.stringify({modules:paths.length,runtimeCycles:[...cycles],domainUiImports:violations},null,2));
if(cycles.size||violations.length)process.exitCode=1;
