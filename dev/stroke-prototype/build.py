import json,os,sys
S=sys.argv[1]
INFO={"一":["yī","หนึ่ง","one"],"二":["èr","สอง","two"],"三":["sān","สาม","three"],"十":["shí","สิบ","ten"],"七":["qī","เจ็ด","seven"],"八":["bā","แปด","eight"],"九":["jiǔ","เก้า","nine"],"人":["rén","คน","person"],"大":["dà","ใหญ่","big"],"口":["kǒu","ปาก","mouth"],"日":["rì","ดวงอาทิตย์, วัน","sun, day"],"月":["yuè","ดวงจันทร์, เดือน","moon, month"],"山":["shān","ภูเขา","mountain"],"中":["zhōng","กลาง","middle"],"小":["xiǎo","เล็ก","small"],"上":["shàng","ข้างบน","up, above"],"下":["xià","ข้างล่าง","down, below"],"木":["mù","ไม้, ต้นไม้","wood, tree"],"水":["shuǐ","น้ำ","water"],"火":["huǒ","ไฟ","fire"],"天":["tiān","ท้องฟ้า, วัน","sky, day"],"王":["wáng","กษัตริย์","king"],"土":["tǔ","ดิน","earth, soil"],"女":["nǚ","ผู้หญิง","woman"],"子":["zǐ","ลูก, เด็ก","child"],"门":["mén","ประตู","door"],"心":["xīn","หัวใจ","heart"],"手":["shǒu","มือ","hand"],"目":["mù","ตา","eye"],"田":["tián","ทุ่งนา","field"],"白":["bái","สีขาว","white"],"力":["lì","แรง, กำลัง","strength"],"工":["gōng","งาน","work"],"万":["wàn","หมื่น","ten thousand"],"才":["cái","เพิ่งจะ, พรสวรรค์","only then, talent"]}
D={}
for c in list(INFO)+["笔"]:
  d=json.load(open(f"{S}/hwdata/{c}.json"))
  D[c]={"s":d["strokes"],"m":d["medians"]}
data="const INFO="+json.dumps(INFO,ensure_ascii=False,separators=(',',':'))+";\nconst DATA="+json.dumps(D,ensure_ascii=False,separators=(',',':'))+";"
html=open(f"{S}/stroke/template.html").read()
matcher=open(f"{S}/stroke/matcher.js").read().replace("if (typeof module !== 'undefined') module.exports = M;\n","")
html=html.replace("/*DATA*/",data).replace("/*MATCHER*/",matcher).replace("/*GAME*/",open(f"{S}/stroke/game.js").read())
open(f"{S}/stroke-master.html","w").write(html)
print(len(html))
