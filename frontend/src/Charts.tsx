import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import {LineChart,RadarChart,GraphChart,BarChart} from 'echarts/charts';
import {TooltipComponent,GridComponent,LegendComponent,DataZoomComponent,MarkLineComponent,TitleComponent,AriaComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import type {EChartsCoreOption} from 'echarts/core';
import type {Result} from './types';
echarts.use([LineChart,RadarChart,GraphChart,BarChart,TooltipComponent,GridComponent,LegendComponent,DataZoomComponent,MarkLineComponent,TitleComponent,AriaComponent,CanvasRenderer]);
export const COLORS=['#176f70','#db913d','#5274ac','#b56476','#7d6bac','#587f69','#ae795b','#498ca2','#977d2c','#48636d','#a25fa1'];
export const short=['Испарение','Ликвидация','Площадь','Подход','Первичное облако','Вторичное облако','Госпитализация','Техника','Раствор','Ресурсы','Оповещение'];
export const fmt=(x:number,d=3)=>Number.isFinite(x)?x.toLocaleString('ru-RU',{maximumFractionDigits:d}):'–';

export function Chart({option,height=310,label}:{option:EChartsCoreOption;height?:number;label:string}){
 const div=useRef<HTMLDivElement>(null), chart=useRef<echarts.EChartsType|null>(null);
 useEffect(()=>{if(!div.current)return;chart.current=echarts.init(div.current,undefined,{renderer:'canvas',devicePixelRatio:2});
  const o=new ResizeObserver(()=>chart.current?.resize());o.observe(div.current);return()=>{o.disconnect();chart.current?.dispose();};},[]);
 useEffect(()=>{chart.current?.setOption({animation:false,textStyle:{fontFamily:'Segoe UI, Arial, sans-serif',color:'#55646d'},...option},true);},[option]);
 return <div className="chart-wrap"><div ref={div} role="img" aria-label={label} style={{height,width:'100%'}}/><button className="chart-export" title="Скачать график PNG" aria-label={`Скачать ${label}`} onClick={()=>{if(!chart.current)return;const a=document.createElement('a');a.href=chart.current.getDataURL({type:'png',pixelRatio:2,backgroundColor:'#ffffff'});a.download=label.replace(/[^\p{L}\p{N}]/gu,'_')+'.png';a.click();}}>PNG ↓</button></div>;
}

export function lineOption(r:Result, index:number, cursor?:number, comparison?:Result|null, type:'y'|'factors'|'derivatives'='y'):EChartsCoreOption{
 const plot=(rr:Result)=>rr.t.map((t,i)=>[t,rr[type][i][index]]);
 const series:object[]=[{name:type==='factors'?`F${index+1}`:`X${index+1}`,type:'line',showSymbol:false,data:plot(r),lineStyle:{width:2.4,color:COLORS[index%COLORS.length]},areaStyle:{color:COLORS[index%COLORS.length],opacity:0.06},markLine:cursor===undefined?undefined:{silent:true,symbol:'none',label:{show:false},lineStyle:{color:'#d19a45',type:'dashed'},data:[{xAxis:cursor}]}}];
 if(comparison)series.push({name:'Сценарий сравнения',type:'line',showSymbol:false,data:plot(comparison),lineStyle:{color:'#8b99a2',type:'dashed',width:1.7}});
 return {aria:{enabled:true},grid:{left:52,right:18,top:28,bottom:48,containLabel:false},tooltip:{trigger:'axis',valueFormatter:(v:unknown)=>fmt(Number(v),6)},xAxis:{type:'value',min:0,max:r.config.t_end,name:'τ',nameGap:8,axisLine:{lineStyle:{color:'#cbd5d8'}},splitLine:{show:false},axisLabel:{formatter:(v:number)=>fmt(v,2)}},yAxis:{type:'value',scale:true,axisLabel:{formatter:(v:number)=>fmt(v)},splitLine:{lineStyle:{color:'#edf1f2'}}},series};
}

export function Radar({r,comparison}:{r:Result;comparison?:Result|null}){
 if(r.quarters.some(q=>q.values.some(v=>v<0)))return <div className="dirty">Лепестковая диаграмма не строится для отрицательных характеристик. Значения не обрезаны: они доступны в таблице срезов, временных графиках и экспорте.</div>;
 const scales=r.radar_scales.map((x,i)=>Math.max(x,comparison?.radar_scales[i]??0));
 const option:EChartsCoreOption={tooltip:{trigger:'item'},legend:{bottom:0,itemWidth:18,data:r.quarters.map(q=>`τ = ${fmt(q.t,2)}`)},radar:{radius:'64%',center:['50%','45%'],splitNumber:4,indicator:short.map((s,i)=>({name:`X${i+1}\n${s}`,max:1})),axisName:{fontSize:11,color:'#52646e'},splitArea:{areaStyle:{color:['#fff','#f8fafb']}},splitLine:{lineStyle:{color:'#e0e8ea'}},axisLine:{lineStyle:{color:'#e0e8ea'}}},series:[{type:'radar',symbolSize:3,lineStyle:{width:2},data:r.quarters.map((q,i)=>({name:`τ = ${fmt(q.t,2)}`,value:q.values.map((v,j)=>v/scales[j]),itemStyle:{color:COLORS[i]},areaStyle:{opacity:i===3?0.045:0}}))}]};
 return <Chart label="Лепестковые диаграммы четырёх четвертей" option={option} height={480}/>;
}

export function DependencyGraph({r}:{r:Result}){
 const nodes=[...Array.from({length:7},(_,i)=>({name:`F${i+1}`,x:60,y:30+i*65,symbolSize:32,itemStyle:{color:'#d6b476'},label:{color:'#33434c'}})),...short.map((s,i)=>({name:`X${i+1}`,x:300+(i%3)*180,y:30+Math.floor(i/3)*135,symbolSize:47,itemStyle:{color:COLORS[i]},label:{color:'#fff'}}))];
 const links=r.dependencies.flatMap(d=>d.sources.filter(s=>s!=='t').map(s=>({source:s,target:d.target})));
 return <Chart label="Граф зависимостей действующей модели" height={490} option={{tooltip:{formatter:(p:any)=>p.dataType==='node'?`${p.name} ${p.name.startsWith('X')?r.state_names[+p.name.slice(1)-1]:r.factor_names[+p.name.slice(1)-1]}`:`${p.data.source} → ${p.data.target}`},series:[{type:'graph',layout:'none',data:nodes,links,roam:true,label:{show:true,fontWeight:600},edgeSymbol:['none','arrow'],edgeSymbolSize:7,lineStyle:{color:'#9bafb7',opacity:0.35,curveness:0.08},emphasis:{focus:'adjacency',lineStyle:{width:2,opacity:1}},scaleLimit:{min:0.7,max:2.5}}]}}/>;
}
