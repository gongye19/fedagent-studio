"""过程记录模式：平台提取、聚合，再由应用使用；不画站点 Agent 或迭代回路。"""


def diagram(key, mobile=False):
    evo = key == 'evomedclaw-records'
    name = 'EvoMedClaw' if evo else 'FoT'
    width, height = (320, 740) if mobile else (1040, 490)
    elements = []
    def box(x, y, w, h, title, note, color='blue'):
        elements.append({'type':'box','x':x,'y':y,'w':w,'h':h,'color':color,'fill':'bg','pad':[12,10], 'align':'center',
                         'lines':[{'t':title,'b':1,'c':color,'size':16},{'t':note,'c':'dim','size':13}]})
    def wire(points):
        elements.append({'type':'path','points':points,'color':'blue','width':1.5,'arrow':True,
                         'flow':{'period':3,'offsets':[0.5],'color':'blue','tail':8}})
    labels = [('来源 A / B','上传已完成的过程记录'),
              ('平台校验过程' if evo else '平台提取经验','校验诊断与原始过程' if evo else '反思 → 每条最多 3 条经验'),
              ('按来源编译经验卡' if evo else '聚合文字经验','原版过程卡编译' if evo else '汇总 → 归类 → paper-auto'),
              ('聚合医疗经验库' if evo else '发布经验库','按签名合并经验卡' if evo else '保留可追溯来源'),
              ('医疗问诊应用' if evo else '医疗问诊 / 数学推理','新输入 + 选定经验库 → 回答')]
    if mobile:
        for i,(title,note) in enumerate(labels):
            y=20+i*136
            box(20,y,280,80,title,note,'purple' if i==4 else 'green' if i==3 else 'blue')
            if i: wire([[160,y-56],[160,y]])
    else:
        rects=[(24,34,280,86),(380,34,280,86),(736,34,280,86),(380,216,280,86),(380,374,280,86)]
        for i,((title,note),(x,y,w,h)) in enumerate(zip(labels,rects)):
            box(x,y,w,h,title,note,'purple' if i==4 else 'green' if i==3 else 'blue')
        wire([[304,77],[380,77]])
        wire([[660,77],[736,77]])
        wire([[876,120],[876,174],[520,174],[520,216]])
        wire([[520,302],[520,374]])
    return {'meta':{'title':name+' · 过程记录经验流程','lang':'zh-CN'},
            'canvas':{'width':width,'height':height,'duration':18,'fps':30},
            'theme':{'preset':'light-pastel','font':'PingFang SC, Microsoft YaHei, Arial, sans-serif','fontSize':16,
                     'lineHeight':24,'radius':10,'borderWidth':1.2,'packetSize':5,'glow':False,
                     'colors':{'blue':'#2563eb','green':'#15803d','purple':'#7c3aed','bg':'#ffffff','fg':'#25262b','dim':'#646b77','border':'#dce1e8'}},
            'machines':{},'elements':elements,
            'credit':{'text':'平台托管过程记录 · 不更新模型权重','y':height-12,'size':12}}
