from pptx import Presentation
from pptx.util import Emu
p=Presentation(); p.slide_width=Emu(12192000); p.slide_height=Emu(6858000)
for i in range(1,7):
    s=p.slides.add_slide(p.slide_layouts[6]); s.shapes.add_picture(f'slide-{i}.png',0,0,p.slide_width,p.slide_height)
p.save('/Users/zeke/Desktop/BreathBuddy-slides.pptx')
