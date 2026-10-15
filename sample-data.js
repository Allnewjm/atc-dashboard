// DEMO DATA ONLY. Fictional. Real data is imported in-browser and stays in localStorage.
window.SAMPLE_DATA = (function(){
  const d = n => { const x = new Date(); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };
  const t = (n,h,m,dur) => { const x = new Date(); x.setDate(x.getDate()+n); x.setHours(h,m||0,0,0); const e = new Date(x.getTime()+(dur||60)*60000); return [x.toISOString(), e.toISOString()]; };
  const ev = (id,title,n,h,m,dur,category,block) => { const [s,e]=t(n,h,m,dur); return {id,title,start:s,end:e,allDay:false,category,block:!!block}; };
  return {
    label: 'SAMPLE / DEMO DATA (fictional)', generated: new Date().toISOString().slice(0,16), today: d(0),
    items: [
      {id:'#1',title:'Fix leaking kitchen faucet',owner:'Me',status:'NOW',priority:0,due:d(-2),category:'Must-do/household',notes:'Top priority. Parts bought.'},
      {id:'#2',title:'Buy groceries for the week',owner:'Me',status:'NOW',priority:1,due:d(1),category:'Must-do/household',notes:'List on fridge.'},
      {id:'#3',title:'Send documents to lawyer',owner:'Me',status:'NOW',priority:1,due:d(3),category:'Legal/divorce',notes:'Sample legal item.'},
      {id:'#4',title:'Pay electric bill',owner:'Me',status:'THIS WEEK',priority:2,due:d(3),category:'Money/bills',notes:'Autopay off.'},
      {id:'#5',title:'File quarterly taxes',owner:'Me',status:'THIS WEEK',priority:2,due:d(3),category:'Money/bills',notes:''},
      {id:'#6',title:'School conference prep',owner:'Me',status:'THIS WEEK',priority:2,due:d(5),category:'Kids',notes:''},
      {id:'#7',title:'Finish project report',owner:'Me',status:'NOW',priority:1,due:d(2),category:'Work',notes:''},
      {id:'#8',title:'Draft website copy',owner:'Me',status:'PARKED',priority:4,due:null,category:'Business launch',notes:''},
      {id:'#9',title:'Take online course module 1',owner:'Me',status:'WAITING',priority:3,due:d(14),category:'Ambitions/career',notes:''},
      {id:'#10',title:'Call the car shop',owner:'Me',status:'UNKNOWN',priority:3,due:null,category:'Must-do/household',notes:''}
    ],
    events: [
      ev('e1','Dentist',2,9,0,60,'Must-do/household'),
      ev('e2','Team meeting',2,9,30,60,'Work'),
      ev('e3','Focus block: project report',1,19,0,90,'Work',true),
      ev('e4','Kids soccer game',5,10,0,120,'Kids'),
      ev('e5','Weekly review',7,8,0,30,'Ambitions/career',true),
      ev('e6','Hearing (sample)',10,9,0,60,'Legal/divorce'),
      ev('e7','Dinner with friends',3,18,0,120,'Must-do/household'),
      ev('e8','Late call',3,21,0,60,'Work')
    ],
    goals: {
      statement:'Sample goal: a stable, calm life with time for family and growth.',
      constraint:'Sample constraint: too many open loops (work in progress).',
      hypotheses:[{id:'H1',text:'Too much work in progress.'},{id:'H2',text:'Too few protected focus hours.'}],
      milestones:[{phase:'1',title:'Write goal statement',date:d(9),measure:'One sentence'},{phase:'2',title:'Two-week baseline',date:d(23),measure:'10 of 14 days logged'}],
      source:'Sample'
    },
    sources:{board:'sample',calendar:'sample',goals:'sample'}
  };
})();
