import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ConnectionSettings} from './ConnectionSettings.jsx';
import {Plus,Search,SquarePen,Library,FolderPlus,Folder,PanelLeftClose,PanelLeftOpen,ChevronDown,ChevronRight,ChevronUp,Layers,Table2,MoreHorizontal,Pencil,Share2,Trash2,Settings,Code2,CircleDollarSign,CircleHelp,Users,Puzzle,LogOut,ExternalLink,ArrowLeft,RotateCcw,Copy,Check,X} from 'lucide-react';
import './sidebar.css';

const activeStates=['queued','parsing','extracting','correcting'];
export const displayName=name=>name==='Untitled extraction'?'未命名提取':name;
export const fieldName=name=>({'Study design':'研究设计','Sample size':'样本量','Main findings':'主要发现','Population':'研究对象','Intervention':'干预措施','Study location':'研究地点','Limitations':'研究局限','Randomized trial':'随机对照试验','Sampling depth':'采样深度'}[name]||name);

function Popup({anchor,onClose,children,label,className=''}){
  const ref=useRef(),close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement;ref.current.querySelector('[role=menuitem]')?.focus();
    const pointer=e=>{if(!ref.current?.contains(e.target))close.current();};
    const keyboard=e=>{
      if(e.key==='Escape'){e.preventDefault();close.current();}
      if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
        const items=[...ref.current.querySelectorAll('[role=menuitem]:not(:disabled)')];const i=items.indexOf(document.activeElement);e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();
      }
      if(e.key==='Tab')close.current();
    };
    document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',keyboard);
    const resize=()=>close.current();window.addEventListener('resize',resize);
    return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',keyboard);window.removeEventListener('resize',resize);if(!document.activeElement||document.activeElement===document.body)previous?.focus();};
  },[]);
  return createPortal(<div ref={ref} role="menu" aria-label={label} className={`workspace-popup ${className}`} style={anchor}>{children}</div>,document.body);
}
const item=(Icon,text,fn,extra={})=><button type="button" role="menuitem" onClick={fn} {...extra}><Icon size={16}/><span>{text}</span></button>;

export function WorkspaceSidebar({api,Modal,projects,selectedId,selectedFolderId,screen,collapsed,setCollapsed,health,working,home,onCreate,openProject,navigate,onUpdated,onTrashed,onFolderSelect,onFolderUpdated,onFolderDeleted,profile,setProfile,onConnectionsChanged}){
  const [menu,setMenu]=useState(null),[dialog,setDialog]=useState(null),[target,setTarget]=useState(null),[name,setName]=useState(''),[folderId,setFolderId]=useState('');
  const [folders,setFolders]=useState([]),[trash,setTrash]=useState([]),[shares,setShares]=useState([]),[error,setError]=useState(''),[pending,setPending]=useState(false),[notice,setNotice]=useState(''),[helpOpen,setHelpOpen]=useState(false);
  const [form,setForm]=useState(profile),[exited,setExited]=useState(false);
  const [foldersOpen,setFoldersOpen]=useState(true),[recentsOpen,setRecentsOpen]=useState(true),[mobileOpen,setMobileOpen]=useState(false);
  const go=action=>()=>{setMobileOpen(false);action();};
  const toggleSidebar=()=>{if(window.matchMedia('(max-width: 780px)').matches)setMobileOpen(v=>!v);else setCollapsed(!collapsed);};
  useEffect(()=>{if(!mobileOpen)return;const closeOnEscape=e=>{if(e.key==='Escape')setMobileOpen(false);};document.addEventListener('keydown',closeOnEscape);return()=>document.removeEventListener('keydown',closeOnEscape);},[mobileOpen]);
  useEffect(()=>{api('/workspace/folders').then(setFolders).catch(e=>setError(e.message));},[api]);
  const act=async fn=>{setPending(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setPending(false);}};
  const close=()=>{setDialog(null);setError('');setNotice('');};
  const show=(which,p)=>{setMenu(null);setError('');setNotice('');setTarget(p||null);setDialog(which);if(p){setName(p.name);setFolderId(p.folder_id||'');}if(which==='settings')setForm(profile);if(which==='folder-new')setName('');if(which==='trash')act(async()=>setTrash(await api('/projects?trash=1')));if(which==='share')act(async()=>setShares(await api(`/projects/${p.id}/shares`)));};
  const more=(e,p,type='recent')=>{e.preventDefault();e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();setMenu({type,p,anchor:{left:Math.max(8,Math.min(r.right-232,innerWidth-248)),top:Math.max(8,Math.min(r.bottom+5,innerHeight-193))}});};
  const createInFolder=f=>{setMenu(null);setMobileOpen(false);onCreate(f.id);};
  const copy=async token=>{const link=`${location.origin}/?share=${token}`;try{await navigator.clipboard.writeText(link);setNotice('链接已复制');}catch{setNotice('浏览器未允许剪贴板访问，请选择上方链接手动复制。');}};
  const initial=Array.from(profile.name||'科研')[0].toUpperCase();
  return <>
    {mobileOpen&&<button className="sidebar-scrim" aria-label="关闭侧栏" onClick={()=>setMobileOpen(false)}/>}
    <aside className={`sidebar ${mobileOpen?'mobile-open':''}`} aria-label="工作区侧栏">
      <div className="brand-row">
        <button onClick={go(home)} className="brand" aria-label="SIE-agent 首页">SIE-agent</button>
        <div className="sidebar-header-actions"><button className="icon-btn sidebar-search" aria-label="搜索任务" title="搜索任务" onClick={go(()=>navigate('recents'))}><Search size={17}/></button><button className="icon-btn sidebar-toggle" aria-label="展开或收起侧栏" title="展开或收起侧栏" onClick={toggleSidebar}>{collapsed?<PanelLeftOpen size={17}/>:<PanelLeftClose size={17}/>}</button></div>
      </div>
      <nav aria-label="主导航">
        <button onClick={go(onCreate)} disabled={working} title="新建提取"><SquarePen size={17}/><span>新建提取</span></button>
        <button className={screen==='workspace'||screen==='recents'&&!selectedFolderId?'active':''} onClick={go(()=>navigate('recents'))} title="工作区"><Table2 size={17}/><span>工作区</span></button>
        <button className={screen==='library'?'active':''} onClick={go(()=>navigate('library'))} title="文献库"><Library size={17}/><span>文献库</span></button>
      </nav>
      <nav aria-label="服务配置"><button className={dialog==='connections'?'active':''} onClick={go(()=>show('connections'))} title="API 配置"><Settings size={17}/><span>API 配置</span></button></nav>
      <section className="sidebar-section folder-nav" aria-label="项目">
        <div className="sidebar-section-heading"><button className="sidebar-section-toggle" aria-expanded={foldersOpen} aria-controls="sidebar-folders" onClick={()=>setFoldersOpen(v=>!v)}>项目<ChevronDown size={12} className={foldersOpen?'':'closed'}/></button><button className="icon-btn" aria-label="新建项目" title="新建项目" onClick={go(()=>show('folder-new'))}><Plus size={16}/></button></div>
        {foldersOpen&&<div id="sidebar-folders" className="folder-items">{folders.map(f=><div key={f.id} className={`folder-item ${screen==='recents'&&selectedFolderId===f.id?'active':''}`} onContextMenu={e=>more(e,f,'folder')}>
          <button className="folder-open" title={f.name} aria-current={screen==='recents'&&selectedFolderId===f.id?'page':undefined} onClick={go(()=>onFolderSelect(f))}><Folder size={15}/><span>{f.name}</span><small>{projects.filter(p=>p.folder_id===f.id).length}</small></button>
          <div className="folder-actions"><button className="icon-btn" aria-label={`在${f.name}中新建提取`} title="新建提取" disabled={working||pending} onClick={()=>createInFolder(f)}><SquarePen size={15}/></button><button className="icon-btn folder-more" aria-label={`${f.name}项目的更多操作`} title="更多操作" aria-haspopup="menu" aria-expanded={menu?.type==='folder'&&menu.p.id===f.id} onClick={e=>more(e,f,'folder')}><MoreHorizontal size={16}/></button></div>
        </div>)}{!folders.length&&<p className="sidebar-empty">用项目整理提取任务</p>}</div>}
      </section>
      <section className="sidebar-section recent-nav" aria-label="最近任务">
        <div className="sidebar-section-heading"><button className="sidebar-section-toggle" aria-expanded={recentsOpen} aria-controls="sidebar-recents" onClick={()=>setRecentsOpen(v=>!v)}>最近<ChevronDown size={12} className={recentsOpen?'':'closed'}/></button><div className="sidebar-section-actions"><button className="icon-btn" aria-label="查看所有任务" title="查看所有任务" onClick={go(()=>navigate('recents'))}><MoreHorizontal size={16}/></button><button className="icon-btn" aria-label="新建提取任务" title="新建提取任务" disabled={working} onClick={go(onCreate)}><SquarePen size={16}/></button></div></div>
        {recentsOpen&&<div id="sidebar-recents" className="recent-items">{projects.map(p=><div key={p.id} className={`recent-item ${selectedId===p.id&&screen==='workspace'?'active':''}`} onContextMenu={e=>more(e,p)}><button className="recent-open" title={displayName(p.name)} aria-current={selectedId===p.id&&screen==='workspace'?'page':undefined} onClick={go(()=>openProject(p))}><span>{displayName(p.name)}</span>{activeStates.includes(p.status)&&<i className="live-dot"/>}</button><button className="recent-more" aria-label={`${displayName(p.name)}的更多操作`} aria-haspopup="menu" aria-expanded={menu?.type==='recent'&&menu.p.id===p.id} onClick={e=>more(e,p)} title="更多操作"><MoreHorizontal size={16}/></button></div>)}{!projects.length&&<p className="sidebar-empty">新建提取后，任务会显示在这里</p>}</div>}
      </section>
      <div className="sidebar-bottom"><div className={`connection ${health?.status==='ready'?'ready':''}`}><i/>{health?.status==='ready'?'所选服务已就绪':health?.status==='configured'?'API 已配置 · 尚未测试':health?'请检查 API 配置':'正在检查服务配置'}</div><button className={`user-row ${menu?.type==='account'?'active':''}`} aria-label="账户菜单" aria-haspopup="menu" aria-expanded={menu?.type==='account'} onClick={()=>{setHelpOpen(false);setMenu({type:'account',anchor:{left:8,bottom:70}});}}><span className="avatar">{initial}</span><span>{profile.name}<small>本地工作区 · Pi 内核</small></span><ChevronUp size={13}/></button></div>
    </aside>
    {menu?.type==='folder'&&<Popup label="项目操作" anchor={menu.anchor} onClose={()=>setMenu(null)}>
      {item(SquarePen,'新建提取',()=>createInFolder(menu.p),{disabled:working||pending})}
      {item(Pencil,'重命名',()=>show('folder-rename',menu.p))}
      {item(Trash2,'删除项目',()=>show('folder-delete',menu.p),{className:'danger',disabled:working||projects.some(p=>p.folder_id===menu.p.id&&activeStates.includes(p.status)),title:projects.some(p=>p.folder_id===menu.p.id&&activeStates.includes(p.status))?'请先完成或停止项目中的提取任务':undefined})}
    </Popup>}
    {menu?.type==='recent'&&<Popup label="最近任务操作" anchor={menu.anchor} onClose={()=>setMenu(null)}>
      {item(Pencil,'重命名',()=>show('rename',menu.p),{disabled:activeStates.includes(menu.p.status)})}
      {item(Share2,'分享',()=>show('share',menu.p))}
      {item(FolderPlus,'添加到项目…',()=>show('folder',menu.p),{disabled:activeStates.includes(menu.p.status)})}
      {item(Trash2,'移入回收站',()=>show('trash-confirm',menu.p),{disabled:activeStates.includes(menu.p.status),className:'trash-action'})}
    </Popup>}
    {menu?.type==='account'&&<Popup label="账户菜单" anchor={menu.anchor} className="account-popup" onClose={()=>setMenu(null)}>
      <div className="account-profile"><span className="avatar">{initial}</span><div><strong>{profile.name}</strong><small>{profile.email||'本地账户 · 未设置邮箱'}</small></div></div>
      <div className="menu-group">{item(Settings,'设置',()=>show('settings'))}{item(Code2,'开发者',()=>show('developer'))}{item(CircleDollarSign,'查看所有方案',()=>show('plans'))}<button role="menuitem" aria-expanded={helpOpen} onClick={()=>setHelpOpen(!helpOpen)}><CircleHelp size={16}/><span>帮助</span><ChevronRight size={14}/></button>{helpOpen&&<div className="help-items">{item(CircleHelp,'使用指南',()=>show('help'))}{item(Trash2,'回收站',()=>show('trash'))}</div>}</div>
      <div className="menu-group">{item(Users,'加入 Slack 社区',()=>show('community'))}{item(Puzzle,'获取扩展',()=>show('extensions'))}</div>
      <div className="menu-group">{item(LogOut,'退出工作区',()=>{setMenu(null);setExited(true);})}</div>
    </Popup>}
    {dialog&&<Modal wide={dialog==='connections'} title={{connections:'模型与 MinerU API 配置',rename:'重命名',share:'分享提取结果',folder:'添加到项目','folder-new':'新建项目','folder-rename':'重命名项目','folder-delete':'删除项目','trash-confirm':'移入回收站',trash:'回收站',settings:'工作区设置',developer:'开发者',plans:'工作区方案',help:'使用指南',community:'社区',extensions:'扩展'}[dialog]} onClose={()=>!pending&&close()}>
      {dialog==='connections'&&<ConnectionSettings onChanged={onConnectionsChanged} onBusyChange={setPending}/>}
      {error&&<p className="dialog-error" role="alert">{error}</p>}
      {dialog==='folder-rename'&&<form className="modal-content" onSubmit={e=>{e.preventDefault();act(async()=>{const f=await api(`/workspace/folders/${target.id}`,{name},'PATCH');setFolders(rows=>rows.map(row=>row.id===f.id?f:row));onFolderUpdated(f);close();});}}><label>项目名称<input required maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label><footer><button type="button" className="button" disabled={pending} onClick={close}>取消</button><button className="button primary" disabled={pending||!name.trim()}>保存名称</button></footer></form>}
      {dialog==='folder-delete'&&<div className="modal-content"><p>删除项目“{target.name}”？</p><p className="muted settings-note">仅移除项目分组，其中的提取任务、论文和结果会保留在“最近”中。</p><footer><button className="button" disabled={pending} onClick={close}>取消</button><button className="button danger" disabled={pending} onClick={()=>act(async()=>{await api(`/workspace/folders/${target.id}`,undefined,'DELETE');setFolders(rows=>rows.filter(f=>f.id!==target.id));await onFolderDeleted(target);close();})}><Trash2 size={15}/>删除项目</button></footer></div>}
      {dialog==='rename'&&<form className="modal-content" onSubmit={e=>{e.preventDefault();act(async()=>{const p=await api(`/projects/${target.id}/rename`,{name});await onUpdated(p);close();});}}><label>任务名称<input required autoFocus maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label><footer><button type="button" className="button" onClick={close}>取消</button><button className="button primary" disabled={pending||!name.trim()}>保存名称</button></footer></form>}
      {dialog==='trash-confirm'&&<div className="modal-content"><p>将“{displayName(target.name)}”移入回收站？论文和提取结果会保留，分享链接将撤销。可从账户菜单的“帮助 → 回收站”恢复。</p><footer><button className="button" onClick={close}>取消</button><button className="button danger" disabled={pending} onClick={()=>act(async()=>{await api(`/projects/${target.id}/trash`,{});await onTrashed(target);close();})}><Trash2 size={15}/>移入回收站</button></footer></div>}
      {dialog==='trash'&&<div className="modal-content"><p className="muted">已移除的任务保留在此，可随时恢复。</p><div className="trash-list">{trash.map(p=><article key={p.id}><Table2 size={16}/><div><strong>{displayName(p.name)}</strong><small>{new Date(p.trashed_at).toLocaleString('zh-CN')}</small></div><button className="button" disabled={pending} onClick={()=>act(async()=>{await api(`/projects/${p.id}/restore`,{});setTrash(await api('/projects?trash=1'));await onUpdated();})}><RotateCcw size={14}/>恢复</button></article>)}{!trash.length&&<p className="empty-message">回收站为空</p>}</div></div>}
      {(dialog==='folder'||dialog==='folder-new')&&<form className="modal-content" onSubmit={e=>{e.preventDefault();act(async()=>{let selected=folderId;if(dialog==='folder-new'||folderId==='new'){const f=await api('/workspace/folders',{name});setFolders(await api('/workspace/folders'));selected=f.id;if(dialog==='folder-new')onFolderSelect(f);}if(dialog==='folder'){const p=await api(`/projects/${target.id}/folder`,{folder_id:selected||null});await onUpdated(p);}close();});}}>
        {dialog==='folder'&&<label>选择项目<select value={folderId} onChange={e=>{setFolderId(e.target.value);setName('');}}><option value="">不归入项目</option>{folders.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}<option value="new">＋ 创建新项目</option></select></label>}
        {(dialog==='folder-new'||folderId==='new')&&<label>项目名称<input required maxLength={200} placeholder="例如：微塑料系统综述" value={name} onChange={e=>setName(e.target.value)}/></label>}<p className="muted settings-note">将多个提取任务归入同一项目，便于整理研究。</p><footer><button type="button" className="button" onClick={close}>取消</button><button className="button primary" disabled={pending}>保存</button></footer>
      </form>}
      {dialog==='share'&&<div className="modal-content"><p>创建当前提取表和引用原文的只读快照。后续修改不会更新已有快照。</p><p className="muted settings-note">链接仅在此工作区服务可访问的网络中有效。收到链接的人可以查看所分享的结果；不包含对话或原始文件下载。</p><div className="share-links">{shares.map(s=><article key={s.token}><label>创建于 {new Date(s.created_at).toLocaleString('zh-CN')}<input readOnly value={`${location.origin}/?share=${s.token}`} onFocus={e=>e.target.select()}/></label><div><button className="button" onClick={()=>copy(s.token)}><Copy size={14}/>复制链接</button><a className="button" href={`/?share=${s.token}`} target="_blank" rel="noreferrer">预览<ExternalLink size={13}/></a><button className="text-button danger" disabled={pending} onClick={()=>act(async()=>{await api(`/projects/${target.id}/shares/${s.token}`,{},'DELETE');setShares(await api(`/projects/${target.id}/shares`));setNotice('链接已撤销');})}>撤销</button></div></article>)}</div>{notice&&<p role="status" className="settings-note">{notice}</p>}<footer><button className="button primary" disabled={pending||activeStates.includes(target.status)} onClick={()=>act(async()=>{const s=await api(`/projects/${target.id}/shares`,{});setShares(v=>[s,...v]);await copy(s.token);})}><Share2 size={15}/>创建只读链接</button></footer>{activeStates.includes(target.status)&&<p className="muted">请在任务完成后创建快照。</p>}</div>}
      {dialog==='settings'&&<form className="modal-content" onSubmit={e=>{e.preventDefault();act(async()=>{setProfile(await api('/workspace/settings',form,'PATCH'));setNotice('设置已保存');});}}><label>显示名称<input required maxLength={200} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>邮箱（可选）<input type="email" maxLength={254} value={form.email} placeholder="仅用于工作区显示" onChange={e=>setForm({...form,email:e.target.value})}/></label><label>工作区字号<select value={form.fontSize} onChange={e=>setForm({...form,fontSize:Number(e.target.value)})}><option value={15}>标准 · 15 px</option><option value={16}>舒适 · 16 px（默认）</option><option value={18}>大号 · 18 px</option></select></label><p className="muted settings-note">界面语言：简体中文。文献原文和已有提取内容保留原始语言。</p>{notice&&<p role="status" className="settings-note"><Check size={14}/> {notice}</p>}<footer><button className="button primary" disabled={pending}>保存设置</button></footer></form>}
      {dialog==='developer'&&<div className="modal-content about-content"><dl><dt>Agent 内核</dt><dd>Pi Coding Agent SDK</dd><dt>模型</dt><dd>{health?.model||'连接中'}</dd><dt>PDF 解析</dt><dd>MinerU</dd><dt>服务状态</dt><dd>{health?.status==='ready'?'已连接':'部分服务未连接'}</dd><dt>数据存储</dt><dd>本机 SQLite 与文件目录</dd></dl><a className="button" href={`/?legacy=1${selectedId?`&project=${selectedId}`:''}`}>打开高级工作区<ExternalLink size={14}/></a></div>}
      {dialog==='plans'&&<div className="modal-content"><span className="plan-tag">当前方案</span><h3>科研工作区</h3><p className="settings-note">项目和结果保存在当前 SIE 服务端，提取和解析使用“API 配置”中选择的服务。</p><p className="muted settings-note">SIE 不提供订阅套餐。外部模型和 MinerU API 的费用与额度由各自服务商管理。</p><button className="button" onClick={()=>show('connections')}>打开 API 配置</button></div>}
      {dialog==='help'&&<div className="modal-content help-guide"><p>1. 新建任务，上传论文或从文献库选择资料。</p><p>2. 定义提取列和说明，运行提取。</p><p>3. 点击答案核对引用原文，审核或修订后导出。</p><p>4. 将鼠标移到最近任务，点击“…”可重命名、分享、归入项目或移入回收站。</p><button className="button" onClick={()=>show('trash')}><Trash2 size={15}/>打开回收站</button><a href="https://support.elicit.com/en/articles/14759154-systematic-reviews-in-elicit" target="_blank" rel="noreferrer">Elicit 官方流程参考<ExternalLink size={13}/></a></div>}
      {dialog==='community'&&<div className="modal-content"><h3>尚未设置工作区社区</h3><p className="settings-note">本地平台尚未配置 Slack 邀请链接。此入口保留在账户菜单中，便于后续接入团队社区。</p></div>}
      {dialog==='extensions'&&<div className="modal-content"><h3>扩展</h3><p className="settings-note">目前未提供独立浏览器扩展。</p></div>}
    </Modal>}
    {exited&&<div className="workspace-exit" role="dialog" aria-modal="true" aria-label="已退出工作区"><Layers size={34}/><h1>已退出工作区</h1><p>论文和提取结果已保存在本机。此操作关闭当前工作视图；本地版不含账号登录认证。</p><button autoFocus className="button primary" onClick={()=>{setExited(false);home();}}>返回工作区</button></div>}
  </>;
}

export function SharePage({api}){
  const [data,setData]=useState(null),[error,setError]=useState('');
  useEffect(()=>{api(`/shares/${new URLSearchParams(location.search).get('share')}`).then(setData).catch(e=>setError(e.message));},[api]);
  return <main className="share-page"><header><span className="brand"><Layers size={24}/> SIE</span><span className="plan-tag">只读分享</span></header>{error?<p role="alert">{error}</p>:!data?<p>正在载入分享…</p>:<><h1>{displayName(data.name)}</h1><p className="muted">快照创建于 {new Date(data.created_at).toLocaleString('zh-CN')} · {data.records.length} 条记录</p><div className="share-table-wrap"><table className="share-table"><thead><tr><th>论文</th>{data.fields.map(f=><th key={f.name}>{fieldName(f.name)}</th>)}</tr></thead><tbody>{data.records.map((r,i)=><tr key={i}><th>{r.label}</th>{data.fields.map(f=>{const c=r.cells[f.name];return <td key={f.name}><p>{c?.value==null?'未找到':String(c.value)}</p>{c?.quotes?.length>0&&<details><summary>查看 {c.quotes.length} 处原文证据</summary>{c.quotes.map((q,j)=><blockquote key={j}><small>{q.file}{q.page?` · 第 ${q.page} 页`:q.location}</small><p>{String(q.text||'').replace(/<[^>]*>/g,' ')}</p></blockquote>)}</details>}</td>;})}</tr>)}</tbody></table></div>{!data.records.length&&<p className="empty-message">快照中暂无提取结果。</p>}</>}</main>;
}
