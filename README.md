# ATC Personal Control Tower
A static, air-traffic-control-style dashboard for to-dos, calendar, goals, and conflicts.
Views: SCOPE (now/this week), TIMELINE (6 weeks), BOARD (category columns), GOALS.
**Ships with fictional demo data only.** Click *Import data* to load your own `data.json`; it stays in your browser's localStorage and is never uploaded.
Data shape: `{items:[{id,title,owner,status,priority,due,category,notes}], events:[{id,title,start,end,allDay,category,block}], goals:{statement,constraint,hypotheses,milestones}}`.
