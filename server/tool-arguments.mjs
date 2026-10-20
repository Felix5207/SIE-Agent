// Some local models encode array/object arguments as JSON strings. Decode only
// schema-declared containers; never rewrite answer strings or numeric values.
export function prepareArguments(value,schema){
 if(!schema)return value;
 if(['array','object'].includes(schema.type)&&typeof value==='string'){
  const text=value.trim();
  try{value=JSON.parse(text);}catch{
   // An array occasionally carries the tool object's extra closing brace.
   // Accept it only when the entire preceding string is a complete JSON array.
   if(schema.type==='array'&&text.endsWith(']}')){try{const decoded=JSON.parse(text.slice(0,-1));if(Array.isArray(decoded))value=decoded;}catch{}}
  }
 }
 if(schema.type==='array'&&Array.isArray(value))return value.map(v=>prepareArguments(v,schema.items));
 if(schema.type==='object'&&value&&typeof value==='object'&&!Array.isArray(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,prepareArguments(v,schema.properties?.[k])]));
 return value;
}
export function toolOperation(tool,args){
 const raw=args?.updates??args?.cells;
 const cells=Array.isArray(raw)?raw:raw===undefined?[args]:[];
 return {tool,cells:cells.filter(c=>c&&typeof c.record_id==='string'&&typeof c.field==='string').map(c=>({record_id:c.record_id,field:c.field})),file_id:typeof args?.file_id==='string'?args.file_id:null};
}
