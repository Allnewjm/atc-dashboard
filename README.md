# ATC Personal Control Tower
A static, air-traffic-control-style dashboard for to-dos, calendar, goals, and conflicts.
Views: SCOPE (now/this week), TIMELINE (6 weeks), BOARD (category columns), GOALS.
**Ships with fictional demo data only.** Your real board lives privately in Google Drive (`ATC Dashboard/atc-board-data.json`), never in this repo. Click *Import data* and pick that file; it stays in your browser's localStorage and is never uploaded.
Data shape: `{items:[{id,title,owner,status,priority,due,category,notes}], events:[{id,title,start,end,allDay,category,block}], goals:{statement,constraint,hypotheses,milestones}}`.
