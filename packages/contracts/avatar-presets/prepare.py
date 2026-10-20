"""Flatten circular SVG clips into vector paths; requires fonttools and skia-pathops."""
import copy, math, re, sys
from pathlib import Path
import xml.etree.ElementTree as ET
import pathops
from fontTools.svgLib.path import parse_path
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.misc.transform import Transform, Identity
ET.register_namespace('', 'http://www.w3.org/2000/svg')
NS='{http://www.w3.org/2000/svg}'
def tag(e): return e.tag.removeprefix(NS)
def num(n): return f'{n:.4f}'.rstrip('0').rstrip('.') if n else '0'
def shape(e):
 a=e.attrib; t=tag(e); f=lambda k,d=0: float(a.get(k,d))
 if t=='path': d=a['d']
 elif t in ['circle','ellipse']:
  x,y=f('cx'),f('cy'); rx=f('r') if t=='circle' else f('rx'); ry=f('r') if t=='circle' else f('ry')
  d=f'M{x-rx} {y}a{rx} {ry} 0 1 0 {2*rx} 0a{rx} {ry} 0 1 0 {-2*rx} 0Z'
 elif t=='rect':
  x,y,w,h=f('x'),f('y'),f('width'),f('height'); rx=min(f('rx',a.get('ry',0)),w/2); ry=min(f('ry',a.get('rx',0)),h/2)
  d=f'M{x+rx} {y}H{x+w-rx}Q{x+w} {y} {x+w} {y+ry}V{y+h-ry}Q{x+w} {y+h} {x+w-rx} {y+h}H{x+rx}Q{x} {y+h} {x} {y+h-ry}V{y+ry}Q{x} {y} {x+rx} {y}Z' if rx and ry else f'M{x} {y}h{w}v{h}h{-w}Z'
 elif t=='line': d=f'M{f("x1")} {f("y1")}L{f("x2")} {f("y2")}'
 elif t in ['polyline','polygon']: d='M'+a['points']+('Z' if t=='polygon' else '')
 else: raise ValueError(t)
 p=pathops.Path();parse_path(d,p.getPen())
 return p

def transform(value):
 result=Identity
 for kind, body in re.findall(r'([A-Za-z]+)\(([^)]*)\)',value):
  v=[float(x) for x in re.findall(r'[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?',body)]
  if kind=='translate': result=result.translate(v[0],v[1] if len(v)>1 else 0)
  elif kind=='rotate':
   cx,cy=v[1:] if len(v)==3 else (0,0)
   result=result.translate(cx,cy).rotate(math.radians(v[0])).translate(-cx,-cy)
  elif kind=='matrix': result=result.transform(Transform(*v))
  elif kind=='scale': result=result.scale(v[0],v[1] if len(v)>1 else v[0])
  else: raise ValueError(kind)
 return result

def convert(file, destination):
 root=ET.parse(file).getroot(); defs=root.find(NS+'defs'); clips={}
 for e in list(defs):
  if tag(e)=='clipPath':
   assert len(e)==1
   clips[e.get('id')]=shape(e[0]);defs.remove(e)
 gradients={e.get('id'): e for e in defs}
 converted=ET.Element(NS+'svg', {'viewBox':root.get('viewBox')}); newdefs=copy.deepcopy(defs); converted.append(newdefs)
 paint_keys=['fill','stroke','fill-opacity','stroke-opacity','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','fill-rule','stroke-dasharray','stroke-dashoffset']
 def gradient(paint,bounds):
  if not paint.startswith('url('):return paint
  source=gradients[paint[5:-1]]
  if source.get('gradientUnits')=='userSpaceOnUse': return paint
  x,y,right,bottom=bounds;w,h=right-x,bottom-y
  if not w or not h:return paint
  g=copy.deepcopy(source)
  defaults={'x1':'0','y1':'0','x2':'1','y2':'0'} if tag(g)=='linearGradient' else {'cx':'.5','cy':'.5','r':'.5'}
  for key,value in defaults.items():g.set(key,source.get(key,value))
  if tag(g)=='radialGradient':
   g.set('fx',source.get('fx',g.get('cx')));g.set('fy',source.get('fy',g.get('cy')))
  for key in ['x1','y1','x2','y2','cx','cy','r','fx','fy','fr']:
   value=g.get(key,'')
   if value.endswith('%'):g.set(key,num(float(value[:-1])/100))
  name=f'paint{len(newdefs)}';g.set('id',name);g.set('gradientUnits','userSpaceOnUse');g.set('gradientTransform',f'matrix({num(w/10)} 0 0 {num(h/10)} {num(x)} {num(y)}) scale(10)')
  newdefs.append(g);return f'url(#{name})'
 def path_element(p,paint,opacity):
  p.convertConicsToQuads(0.01)
  pen=SVGPathPen(None,ntos=num);p.draw(pen)
  attrs={'d':pen.getCommands(),'fill':paint,'stroke':'none','fill-opacity':opacity,'fill-rule':'nonzero'}
  if opacity!='1':attrs['fill-opacity']=opacity
  return ET.Element(NS+'path',attrs)
 def walk(e,out,clip,inherited):
  t=tag(e)
  if t in ['defs','title','desc']:return
  assert t in ['g','path','circle','ellipse','rect','line','polyline','polygon'],t
  style={**inherited,**{k:v for k,v in e.attrib.items() if k in paint_keys}}
  localclip=clip
  if e.get('transform') and clip is not None:localclip=clip.transform(*transform(e.get('transform')).inverse())
  if e.get('clip-path'):
   own=clips[e.get('clip-path')[5:-1]]
   localclip=own if localclip is None else pathops.op(localclip,own,pathops.PathOp.INTERSECTION)
  if t=='g':
   g=ET.SubElement(out,NS+'g',{k:v for k,v in e.attrib.items() if k!='clip-path'})
   for child in e:walk(child,g,localclip,style)
   return
  p=shape(e)
  if style.get('fill-rule')=='evenodd':p.fillType=pathops.FillType.EVEN_ODD
  fill=style.get('fill','black');stroke=style.get('stroke','none')
  filled=pathops.op(p,localclip,pathops.PathOp.INTERSECTION) if localclip is not None and fill!='none' else p
  stroked=None
  if stroke!='none':
   stroked=pathops.Path(p)
   caps={'butt':pathops.LineCap.BUTT_CAP,'round':pathops.LineCap.ROUND_CAP,'square':pathops.LineCap.SQUARE_CAP}
   joins={'miter':pathops.LineJoin.MITER_JOIN,'round':pathops.LineJoin.ROUND_JOIN,'bevel':pathops.LineJoin.BEVEL_JOIN}
   dash=style.get('stroke-dasharray','none')
   stroked.stroke(float(style.get('stroke-width',1)),caps[style.get('stroke-linecap','butt')],joins[style.get('stroke-linejoin','miter')],float(style.get('stroke-miterlimit',4)),None if dash=='none' else [float(n) for n in re.split('[ ,]+',dash)],float(style.get('stroke-dashoffset',0)))
   stroked.convertConicsToQuads(0.01)
  # Keep untouched geometry, strokes and gradients when completely inside the clip.
  fill_changed=fill!='none' and localclip is not None and pathops.op(p,localclip,pathops.PathOp.DIFFERENCE).area>0.00001
  stroke_changed=stroked is not None and localclip is not None and pathops.op(stroked,localclip,pathops.PathOp.DIFFERENCE).area>0.00001
  if not fill_changed and not stroke_changed:
   out.append(copy.deepcopy(e));return
  group=ET.SubElement(out,NS+'g',{k:v for k,v in e.attrib.items() if k in ['opacity','transform']})
  if fill!='none' and filled.area>0:
   group.append(path_element(filled,gradient(fill,p.bounds),style.get('fill-opacity','1')))
  if stroked is not None:
   clipped=pathops.op(stroked,localclip,pathops.PathOp.INTERSECTION)
   if clipped.area>0:group.append(path_element(clipped,gradient(stroke,p.bounds),style.get('stroke-opacity','1')))
 for e in root:walk(e,converted,None,{})
 used={v[5:-1] for e in converted.iter() for k,v in e.attrib.items() if k in ['fill','stroke'] and v.startswith('url(')}
 for e in list(newdefs):
  if e.get('id') not in used:newdefs.remove(e)
 ET.indent(converted,space=' ')
 destination.write_text(ET.tostring(converted,encoding='unicode')+'\n')
 print(file.name,len(destination.read_bytes()),'gradients',len(newdefs))

if __name__=='__main__':
 for file in Path(sys.argv[1]).glob('*.svg'):convert(file,Path(sys.argv[2])/file.name)
