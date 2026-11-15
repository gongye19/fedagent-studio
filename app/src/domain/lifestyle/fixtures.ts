import type { DemoUser } from "./types";

/** 全部为虚构资料，仅用于界面流程；数值与规则不构成医学证据。 */
export const DEMO_USERS: readonly DemoUser[] = [
  {id:"ls-01",name:"用户 01",age:42,sex:"男",height:175,weight:86,activityDays:1,sleepHours:6.5,
    updatedAt:"2026-11-10T09:00:00+08:00",report:{value:2.1,examinedAt:"2026-11-12",uploadedAt:"2026-11-13T10:20:00+08:00"}},
  {id:"ls-02",name:"用户 02",age:46,sex:"女",height:162,weight:77,activityDays:0,sleepHours:6,
    updatedAt:"2026-11-10T10:00:00+08:00",report:{value:2.4,examinedAt:"2026-11-12",uploadedAt:"2026-11-13T14:10:00+08:00"}},
  {id:"ls-03",name:"用户 03",age:39,sex:"男",height:170,weight:81,activityDays:1,sleepHours:7,
    updatedAt:"2026-11-11T09:00:00+08:00",report:{value:1.2,examinedAt:"2026-11-12",uploadedAt:"2026-11-14T09:30:00+08:00"}},
  {id:"ls-04",name:"用户 04",age:45,sex:"男",height:173,weight:85,activityDays:1,sleepHours:6.5,
    updatedAt:"2026-11-14T10:00:00+08:00",report:null},
  {id:"ls-05",name:"用户 05",age:32,sex:"女",height:165,weight:56,activityDays:5,sleepHours:7.5,
    updatedAt:"2026-11-14T11:00:00+08:00",report:null},
  {id:"ls-06",name:"用户 06",age:37,sex:"女",height:168,weight:null,activityDays:null,sleepHours:7,
    updatedAt:"2026-11-14T12:00:00+08:00",report:null},
];

export const UPLOAD_VALUES: Readonly<Record<string, number>> = {"ls-04":1.9,"ls-05":1.0,"ls-06":1.1};
export const EMPTY_SESSION = {version:1 as const, uploads:{}, generation:null, matching:null};
