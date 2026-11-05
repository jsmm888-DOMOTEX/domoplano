/*
 * w2d.js — parser for the Autodesk WHIP!/W2D 2D graphics stream (the .w2d
 * sections of DWF 6 packages, and raw "(DWF V00.xx" WHIP streams).
 *
 * Format details follow the Autodesk DWF Toolkit (whiptk) sources:
 * opcode.cpp, file.cpp, pointset.cpp, polyline.cpp, ellipse.cpp, text.cpp,
 * text_options.cpp, font.cpp, font_options.cpp, color.cpp, colormap.cpp,
 * contour_set.cpp, image.cpp, pnggroup4image.cpp, lz77decp.cpp, preload.h ...
 *
 * AVISO DE LICENCIA: las tablas de color WD_New/Old_Default_Palette y el diccionario
 * WD_History_Buffer_Preload provienen del Autodesk DWF Toolkit, Copyright (c) Autodesk, Inc.,
 * distribuido por Autodesk bajo su licencia del DWF Toolkit (gratuita, perpetua, permite
 * redistribuir código modificado conservando este aviso). El resto es código propio.
 *
 * Plain classic script, no dependencies.  Usage:
 *   W2D.parse(u8) -> Promise<{bounds, items, layers, warnings, ...}>
 */
const W2D = (function () {
  'use strict';

  // WD_New_Default_Palette / WD_Old_Default_Palette from whiptk/palette.h (RGB hex, alpha always 255)
  var PAL_NEW = '000000800000008000808000000080800080008080c0c0c0c0dcc0a6caf00000000000330000660000990000cc0000ff0033000033330033660033990033cc0033ff0066000066330066660066990066cc0066ff0099000099330099660099990099cc0099ff00cc0000cc3300cc6600cc9900cccc00ccff00ff0000ff3300ff6600ff9900ffcc00ffff3300003300333300663300993300cc3300ff3333003333333333663333993333cc3333ff3366003366333366663366993366cc3366ff3399003399333399663399993399cc3399ff33cc0033cc3333cc6633cc9933cccc33ccff33ff0033ff3333ff6633ff9933ffcc33ffff6600006600336600666600996600cc6600ff6633006633336633666633996633cc6633ff6666006666336666666666996666cc6666ff6699006699336699666699996699cc6699ff66cc0066cc3366cc6666cc9966cccc66ccff66ff0066ff3366ff6666ff9966ffcc66ffff9900009900339900669900999900cc9900ff9933009933339933669933999933cc9933ff9966009966339966669966999966cc9966ff9999009999339999669999999999cc9999ff99cc0099cc3399cc6699cc9999cccc99ccff99ff0099ff3399ff6699ff9999ffcc99ffffcc0000cc0033cc0066cc0099cc00cccc00ffcc3300cc3333cc3366cc3399cc33cccc33ffcc6600cc6633cc6666cc6699cc66cccc66ffcc9900cc9933cc9966cc9999cc99cccc99ffcccc00cccc33cccc66cccc99ccccccccccffccff00ccff33ccff66ccff99ccffccccffffff0000ff0033ff0066ff0099ff00ccff00ffff3300ff3333ff3366ff3399ff33ccff33ffff6600ff6633ff6666ff6699ff66ccff66ffff9900ff9933ff9966ff9999ff99ccff99ffffcc00ffcc33ffcc66ffcc99ffccccffccffffff00ffff33ffff66ffff99ffffccffffff0000000d0d0d1a1a1a2828283535354343435050505d5d5d6b6b6b787878868686939393a1a1a1aeaeaebbbbbbc9c9c9d6d6d6e4e4e4f1f1f1fffffffffbf0a0a0a4808080ff000000ff00ffff000000ffff00ff00ffffffffff';
  var PAL_OLD = '000000ff0000ffff0000ff0000ffff0000ffff00ff000000808080dcdcdcff0000ff7f7fdd0000dd6e6eb80000b85c5c950000954a4a720000723939ff3f00ff9f7fdd3700dd8a6eb82e00b8735c952500955d4a721c00724739ff7f00ffbf7fdd6e00dda56eb85c00b88a5c954a0095704a723900725639ffbf00ffdf7fdda500ddc16eb88a00b8a15c95700095834a725600726439ffff00ffff7fdddd00dddd6eb8b800b8b85c95950095954a727200727239bfff00dfff7fa5dd00c1dd6e8ab800a1b85c70950083954a5672006472397fff00bfff7f6edd00a5dd6e5cb8008ab85c4a950070954a3972005672393fff009fff7f37dd008add6e2eb80073b85c2595005d954a1c720047723900ff007fff7f00dd006edd6e00b8005cb85c0095004a954a00720039723900ff3f7fff9f00dd376edd8a00b82e5cb8730095254a955d00721c39724700ff7f7fffbf00dd6e6edda500b85c5cb88a00954a4a957000723939725600ffbf7fffdf00dda56eddc100b88a5cb8a10095704a958300725639726400ffff7fffff00dddd6edddd00b8b85cb8b80095954a959500727239727200bfff7fdfff00a5dd6ec1dd008ab85ca1b80070954a8395005672396472007fff7fbfff006edd6ea5dd005cb85c8ab8004a954a7095003972395672003fff7f9fff0037dd6e8add002eb85c73b80025954a5d95001c723947720000ff7f7fff0000dd6e6edd0000b85c5cb80000954a4a950000723939723f00ff9f7fff3700dd8a6edd2e00b8735cb82500955d4a951c00724739727f00ffbf7fff6e00dda56edd5c00b88a5cb84a0095704a95390072563972bf00ffdf7fffa500ddc16edd8a00b8a15cb8700095834a95560072643972ff00ffff7fffdd00dddd6eddb800b8b85cb8950095954a95720072723972ff00bfff7fdfdd00a5dd6ec1b8008ab85ca1950070954a83720056723964ff007fff7fbfdd006edd6ea5b8005cb85c8a95004a954a70720039723956ff003fff7f9fdd0037dd6e8ab8002eb85c73950025954a5d72001c723947545454767676989898bababadcdcdcffffff';
  // WD_History_Buffer_Preload from whiptk/preload.h (without trailing NUL). zlib preset dictionary = first (len+1-2048) bytes.
  var PRELOAD_B64 = 
    'KERhc2hQYXR0ZXJuIChMaW5lU3R5bGUgKENvcHlyaWdodCAoS2V5d29yZHMgKFZpZXdwb3J0IChDb2RlUGFnZSB7BAQAAAEAAAAAAP8AAID/AIAA/wCAgP+A' +
    'AAD/gACA/4CAAP/AwMD/wNzA//DKpv8AAAD/MwAA/2YAAP+ZAAD/zAAA//8AAP8AMwD/MzMA/2YzAP+ZMwD/zDMA//8zAP8AZgD/M2YA/2ZmAP+ZZgD/zGYA' +
    '//9mAP8AmQD/M5kA/2aZAP+ZmQD/zJkA//+ZAP8AzAD/M8wA/2bMAP+ZzAD/zMwA///MAP8A/wD/M/8A/2b/AP+Z/wD/zP8A////AP8AADP/MwAz/2YAM/+Z' +
    'ADP/zAAz//8AM/8AMzP/MzMz/2YzM/+ZMzP/zDMz//8zM/8AZjP/M2Yz/2ZmM/+ZZjP/zGYz//9mM/8AmTP/M5kz/2aZM/+ZmTP/zJkz//+ZM/8AzDP/M8wz' +
    '/2bMM/+ZzDP/zMwz///MM/8A/zP/M/8z/2b/M/+Z/zP/zP8z////M/8AAGb/MwBm/2YAZv+ZAGb/zABm//8AZv8AM2b/MzNm/2YzZv+ZM2b/zDNm//8zZv8A' +
    'Zmb/M2Zm/2ZmZv+ZZmb/zGZm//9mZv8AmWb/M5lm/2aZZv+ZmWb/zJlm//+ZZv8AzGb/M8xm/2bMZv+ZzGb/zMxm///MZv8A/2b/M/9m/2b/Zv+Z/2b/zP9m' +
    '////Zv8AAJn/MwCZ/2YAmf+ZAJn/zACZ//8Amf8AM5n/MzOZ/2Yzmf+ZM5n/zDOZ//8zmf8AZpn/M2aZ/2Zmmf+ZZpn/zGaZ//9mmf8AmZn/M5mZ/2aZmf+Z' +
    'mZn/zJmZ//+Zmf8AzJn/M8yZ/2bMmf+ZzJn/zMyZ///Mmf8A/5n/M/+Z/2b/mf+Z/5n/zP+Z////mf8AAMz/MwDM/2YAzP+ZAMz/zADM//8AzP8AM8z/MzPM' +
    '/2YzzP+ZM8z/zDPM//8zzP8AZsz/M2bM/2ZmzP+ZZsz/zGbM//9mzP8Amcz/M5nM/2aZzP+Zmcz/zJnM//+ZzP8AzMz/M8zM/2bMzP+ZzMz/zMzM///MzP8A' +
    '/8z/M//M/2b/zP+Z/8z/zP/M////zP8AAP//MwD//2YA//+ZAP//zAD///8A//8AM///MzP//2Yz//+ZM///zDP///8z//8AZv//M2b//2Zm//+ZZv//zGb/' +
    '//9m//8Amf//M5n//2aZ//+Zmf//zJn///+Z//8AzP//M8z//2bM//+ZzP//zMz////M//8A////M////2b///+Z////zP////////8AAAD/DQ0N/xoaGv8o' +
    'KCj/NTU1/0NDQ/9QUFD/XV1d/2tra/94eHj/hoaG/5OTk/+hoaH/rq6u/7u7u//Jycn/1tbW/+Tk5P/x8fH///////D7//+koKD/gICA/wAA//8A/wD/AP//' +
    '//8AAP//AP////8A//////8oTmFtZWRWaWV3IChBdXRob3IgKEJhY2tncm91bmQgKEJlemllciAoQm91bmRzIChDbGlwIChDb2xvciAoQ29sb3JNYXAgKENv' +
    'bW1lbnQgKENyZWF0ZWQgKENyZWF0b3IgKERlc2NyaXB0aW9uIChEcmF3aW5nSW5mbyApKEVtYmVkICdpbWFnZS92bmQuZHdnOycgJ0F1dG9DQUQtcjEzJyAn' +
    'dW5rbm93bi5kd2cnICcnKShWaWV3IChHb3VyYXVkIChJbWFnZSAoTGF5ZXIgKExpbmVDYXAgKExpbmVKb2luIChMaW5lUGF0dGVybiAoTGluZVdlaWdodCAo' +
    'TW9kaWZpZWQgKFByb2plY3Rpb24gKFNjYWxlIChTb3VyY2VDcmVhdGVkIChTb3VyY2VGaWxlbmFtZSAoU291cmNlTW9kaWZpZWQgKFRleHQgKFVSTCAnaHR0' +
    'cDovL3d3dy5jb20nKSdmdHA6Ly9mdHAuMDAwMDEwMDAyMDAwMzAwMDQwMDA1MDAwNjAwMDcwMDA4MDAwOTAwMTEwMDEyMDAxMzAwMTQwMDE1MDAxNjAwMTcw' +
    'MDE4MDAxOTAwMjEwMDIyMDAyMzAwMjQwMDI1MDAyNjAwMjcwMDI4MDAyOTAwMzEwMDMyMDAzMzAwMzQwMDM1MDAzNjAwMzcwMDM4MDAzOTAwNDEwMDQyMDA0' +
    'MzAwNDQwMDQ1MDA0NjAwNDcwMDQ4MDA0OTAwNTEwMDUyMDA1MzAwNTQwMDU1MDA1NjAwNTcwMDU4MDA1OTAwNjEwMDYyMDA2MzAwNjQwMDY1MDA2NjAwNjcw' +
    'MDY4MDA2OTAwNzEwMDcyMDA3MzAwNzQwMDc1MDA3NjAwNzcwMDc4MDA3OTAwODEwMDgyMDA4MzAwODQwMDg1MDA4NjAwODcwMDg4MDA4OTAwOTEwMDkyMDA5' +
    'MzAwOTQwMDk1MDA5NjAwOTcwMDk4MDA5OTAxMDEwMjAxMDMwMTA0MDEwNTAxMDYwMTA3MDEwODAxMDkwMTExMDExMjAxMTMwMTE0MDExNTAxMTYwMTE3MDEx' +
    'ODAxMTkwMTIxMDEyMjAxMjMwMTI0MDEyNTAxMjYwMTI3MDEyODAxMjkwMTMxMDEzMjAxMzMwMTM0MDEzNTAxMzYwMTM3MDEzODAxMzkwMTQxMDE0MjAxNDMw' +
    'MTQ0MDE0NTAxNDYwMTQ3MDE0ODAxNDkwMTUxMDE1MjAxNTMwMTU0MDE1NTAxNTYwMTU3MDE1ODAxNTkwMTYxMDE2MjAxNjMwMTY0MDE2NTAxNjYwMTY3MDE2' +
    'ODAxNjkwMTcxMDE3MjAxNzMwMTc0MDE3NTAxNzYwMTc3MDE3ODAxNzkwMTgxMDE4MjAxODMwMTg0MDE4NTAxODYwMTg3MDE4ODAxODkwMTkxMDE5MjAxOTMw' +
    'MTk0MDE5NTAxOTYwMTk3MDE5ODAxOTkwMjAyMDMwMjA0MDIwNTAyMDYwMjA3MDIwODAyMDkwMjExMDIxMjAyMTMwMjE0MDIxNTAyMTYwMjE3MDIxODAyMTkw' +
    'MjIxMDIyMjAyMjMwMjI0MDIyNTAyMjYwMjI3MDIyODAyMjkwMjMxMDIzMjAyMzMwMjM0MDIzNTAyMzYwMjM3MDIzODAyMzkwMjQxMDI0MjAyNDMwMjQ0MDI0' +
    'NTAyNDYwMjQ3MDI0ODAyNDkwMjUxMDI1MjAyNTMwMjU0MDI1NTAyNTYwMjU3MDI1ODAyNTkwMjYxMDI2MjAyNjMwMjY0MDI2NTAyNjYwMjY3MDI2ODAyNjkw' +
    'MjcxMDI3MjAyNzMwMjc0MDI3NTAyNzYwMjc3MDI3ODAyNzkwMjgxMDI4MjAyODMwMjg0MDI4NTAyODYwMjg3MDI4ODAyODkwMjkxMDI5MjAyOTMwMjk0MDI5' +
    'NTAyOTYwMjk3MDI5ODAyOTkwMzAzMDQwMzA1MDMwNjAzMDcwMzA4MDMwOTAzMTEwMzEyMDMxMzAzMTQwMzE1MDMxNjAzMTcwMzE4MDMxOTAzMjEwMzIyMDMy' +
    'MzAzMjQwMzI1MDMyNjAzMjcwMzI4MDMyOTAzMzEwMzMyMDMzMzAzMzQwMzM1MDMzNjAzMzcwMzM4MDMzOTAzNDEwMzQyMDM0MzAzNDQwMzQ1MDM0NjAzNDcw' +
    'MzQ4MDM0OTAzNTEwMzUyMDM1MzAzNTQwMzU1MDM1NjAzNTcwMzU4MDM1OTAzNjEwMzYyMDM2MzAzNjQwMzY1MDM2NjAzNjcwMzY4MDM2OTAzNzEwMzcyMDM3' +
    'MzAzNzQwMzc1MDM3NjAzNzcwMzc4MDM3OTAzODEwMzgyMDM4MzAzODQwMzg1MDM4NjAzODcwMzg4MDM4OTAzOTEwMzkyMDM5MzAzOTQwMzk1MDM5NjAzOTcw' +
    'Mzk4MDM5OTA0MDQwNTA0MDYwNDA3MDQwODA0MDkwNDExMDQxMjA0MTMwNDE0MDQxNTA0MTYwNDE3MDQxODA0MTkwNDIxMDQyMjA0MjMwNDI0MDQyNTA0MjYw' +
    'NDI3MDQyODA0MjkwNDMxMDQzMjA0MzMwNDM0MDQzNTA0MzYwNDM3MDQzODA0MzkwNDQxMDQ0MjA0NDMwNDQ0MDQ0NTA0NDYwNDQ3MDQ0ODA0NDkwNDUxMDQ1' +
    'MjA0NTMwNDU0MDQ1NTA0NTYwNDU3MDQ1ODA0NTkwNDYxMDQ2MjA0NjMwNDY0MDQ2NTA0NjYwNDY3MDQ2ODA0NjkwNDcxMDQ3MjA0NzMwNDc0MDQ3NTA0NzYw' +
    'NDc3MDQ3ODA0NzkwNDgxMDQ4MjA0ODMwNDg0MDQ4NTA0ODYwNDg3MDQ4ODA0ODkwNDkxMDQ5MjA0OTMwNDk0MDQ5NTA0OTYwNDk3MDQ5ODA0OTkwNTA1MDYw' +
    'NTA3MDUwODA1MDkwNTExMDUxMjA1MTMwNTE0MDUxNTA1MTYwNTE3MDUxODA1MTkwNTIxMDUyMjA1MjMwNTI0MDUyNTA1MjYwNTI3MDUyODA1MjkwNTMxMDUz' +
    'MjA1MzMwNTM0MDUzNTA1MzYwNTM3MDUzODA1MzkwNTQxMDU0MjA1NDMwNTQ0MDU0NTA1NDYwNTQ3MDU0ODA1NDkwNTUxMDU1MjA1NTMwNTU0MDU1NTA1NTYw' +
    'NTU3MDU1ODA1NTkwNTYxMDU2MjA1NjMwNTY0MDU2NTA1NjYwNTY3MDU2ODA1NjkwNTcxMDU3MjA1NzMwNTc0MDU3NTA1NzYwNTc3MDU3ODA1NzkwNTgxMDU4' +
    'MjA1ODMwNTg0MDU4NTA1ODYwNTg3MDU4ODA1ODkwNTkxMDU5MjA1OTMwNTk0MDU5NTA1OTYwNTk3MDU5ODA1OTkwNjA2MDcwNjA4MDYwOTA2MTEwNjEyMDYx' +
    'MzA2MTQwNjE1MDYxNjA2MTcwNjE4MDYxOTA2MjEwNjIyMDYyMzA2MjQwNjI1MDYyNjA2MjcwNjI4MDYyOTA2MzEwNjMyMDYzMzA2MzQwNjM1MDYzNjA2Mzcw' +
    'NjM4MDYzOTA2NDEwNjQyMDY0MzA2NDQwNjQ1MDY0NjA2NDcwNjQ4MDY0OTA2NTEwNjUyMDY1MzA2NTQwNjU1MDY1NjA2NTcwNjU4MDY1OTA2NjEwNjYyMDY2' +
    'MzA2NjQwNjY1MDY2NjA2NjcwNjY4MDY2OTA2NzEwNjcyMDY3MzA2NzQwNjc1MDY3NjA2NzcwNjc4MDY3OTA2ODEwNjgyMDY4MzA2ODQwNjg1MDY4NjA2ODcw' +
    'Njg4MDY4OTA2OTEwNjkyMDY5MzA2OTQwNjk1MDY5NjA2OTcwNjk4MDY5OTA3MDcwODA3MDkwNzExMDcxMjA3MTMwNzE0MDcxNTA3MTYwNzE3MDcxODA3MTkw' +
    'NzIxMDcyMjA3MjMwNzI0MDcyNTA3MjYwNzI3MDcyODA3MjkwNzMxMDczMjA3MzMwNzM0MDczNTA3MzYwNzM3MDczODA3MzkwNzQxMDc0MjA3NDMwNzQ0MDc0' +
    'NTA3NDYwNzQ3MDc0ODA3NDkwNzUxMDc1MjA3NTMwNzU0MDc1NTA3NTYwNzU3MDc1ODA3NTkwNzYxMDc2MjA3NjMwNzY0MDc2NTA3NjYwNzY3MDc2ODA3Njkw' +
    'NzcxMDc3MjA3NzMwNzc0MDc3NTA3NzYwNzc3MDc3ODA3NzkwNzgxMDc4MjA3ODMwNzg0MDc4NTA3ODYwNzg3MDc4ODA3ODkwNzkxMDc5MjA3OTMwNzk0MDc5' +
    'NTA3OTYwNzk3MDc5ODA3OTkwODA4MDkwODExMDgxMjA4MTMwODE0MDgxNTA4MTYwODE3MDgxODA4MTkwODIxMDgyMjA4MjMwODI0MDgyNTA4MjYwODI3MDgy' +
    'ODA4MjkwODMxMDgzMjA4MzMwODM0MDgzNTA4MzYwODM3MDgzODA4MzkwODQxMDg0MjA4NDMwODQ0MDg0NTA4NDYwODQ3MDg0ODA4NDkwODUxMDg1MjA4NTMw' +
    'ODU0MDg1NTA4NTYwODU3MDg1ODA4NTkwODYxMDg2MjA4NjMwODY0MDg2NTA4NjYwODY3MDg2ODA4NjkwODcxMDg3MjA4NzMwODc0MDg3NTA4NzYwODc3MDg3' +
    'ODA4NzkwODgxMDg4MjA4ODMwODg0MDg4NTA4ODYwODg3MDg4ODA4ODkwODkxMDg5MjA4OTMwODk0MDg5NTA4OTYwODk3MDg5ODA4OTkwOTA5MTEwOTEyMDkx' +
    'MzA5MTQwOTE1MDkxNjA5MTcwOTE4MDkxOTA5MjEwOTIyMDkyMzA5MjQwOTI1MDkyNjA5MjcwOTI4MDkyOTA5MzEwOTMyMDkzMzA5MzQwOTM1MDkzNjA5Mzcw' +
    'OTM4MDkzOTA5NDEwOTQyMDk0MzA5NDQwOTQ1MDk0NjA5NDcwOTQ4MDk0OTA5NTEwOTUyMDk1MzA5NTQwOTU1MDk1NjA5NTcwOTU4MDk1OTA5NjEwOTYyMDk2' +
    'MzA5NjQwOTY1MDk2NjA5NjcwOTY4MDk2OTA5NzEwOTcyMDk3MzA5NzQwOTc1MDk3NjA5NzcwOTc4MDk3OTA5ODEwOTgyMDk4MzA5ODQwOTg1MDk4NjA5ODcw' +
    'OTg4MDk4OTA5OTEwOTkyMDk5MzA5OTQwOTk1MDk5NjA5OTcwOTk4MDk5OTExMTEyMTExMzExMTQxMTE1MTExNjExMTcxMTE4MTExOTExMjIxMTIzMTEyNDEx' +
    'MjUxMTI2MTEyNzExMjgxMTI5MTEzMjExMzMxMTM0MTEzNTExMzYxMTM3MTEzODExMzkxMTQyMTE0MzExNDQxMTQ1MTE0NjExNDcxMTQ4MTE0OTExNTIxMTUz' +
    'MTE1NDExNTUxMTU2MTE1NzExNTgxMTU5MTE2MjExNjMxMTY0MTE2NTExNjYxMTY3MTE2ODExNjkxMTcyMTE3MzExNzQxMTc1MTE3NjExNzcxMTc4MTE3OTEx' +
    'ODIxMTgzMTE4NDExODUxMTg2MTE4NzExODgxMTg5MTE5MjExOTMxMTk0MTE5NTExOTYxMTk3MTE5ODExOTkxMjEyMTMxMjE0MTIxNTEyMTYxMjE3MTIxODEy' +
    'MTkxMjIyMTIyMzEyMjQxMjI1MTIyNjEyMjcxMjI4MTIyOTEyMzIxMjMzMTIzNDEyMzUxMjM2MTIzNzEyMzgxMjM5MTI0MjEyNDMxMjQ0MTI0NTEyNDYxMjQ3' +
    'MTI0ODEyNDkxMjUyMTI1MzEyNTQxMjU1MTI1NjEyNTcxMjU4MTI1OTEyNjIxMjYzMTI2NDEyNjUxMjY2MTI2NzEyNjgxMjY5MTI3MjEyNzMxMjc0MTI3NTEy' +
    'NzYxMjc3MTI3ODEyNzkxMjgyMTI4MzEyODQxMjg1MTI4NjEyODcxMjg4MTI4OTEyOTIxMjkzMTI5NDEyOTUxMjk2MTI5NzEyOTgxMjk5MTMxMzE0MTMxNTEz' +
    'MTYxMzE3MTMxODEzMTkxMzIyMTMyMzEzMjQxMzI1MTMyNjEzMjcxMzI4MTMyOTEzMzIxMzMzMTMzNDEzMzUxMzM2MTMzNzEzMzgxMzM5MTM0MjEzNDMxMzQ0' +
    'MTM0NTEzNDYxMzQ3MTM0ODEzNDkxMzUyMTM1MzEzNTQxMzU1MTM1NjEzNTcxMzU4MTM1OTEzNjIxMzYzMTM2NDEzNjUxMzY2MTM2NzEzNjgxMzY5MTM3MjEz' +
    'NzMxMzc0MTM3NTEzNzYxMzc3MTM3ODEzNzkxMzgyMTM4MzEzODQxMzg1MTM4NjEzODcxMzg4MTM4OTEzOTIxMzkzMTM5NDEzOTUxMzk2MTM5NzEzOTgxMzk5' +
    'MTQxNDE1MTQxNjE0MTcxNDE4MTQxOTE0MjIxNDIzMTQyNDE0MjUxNDI2MTQyNzE0MjgxNDI5MTQzMjE0MzMxNDM0MTQzNTE0MzYxNDM3MTQzODE0MzkxNDQy' +
    'MTQ0MzE0NDQxNDQ1MTQ0NjE0NDcxNDQ4MTQ0OTE0NTIxNDUzMTQ1NDE0NTUxNDU2MTQ1NzE0NTgxNDU5MTQ2MjE0NjMxNDY0MTQ2NTE0NjYxNDY3MTQ2ODE0' +
    'NjkxNDcyMTQ3MzE0NzQxNDc1MTQ3NjE0NzcxNDc4MTQ3OTE0ODIxNDgzMTQ4NDE0ODUxNDg2MTQ4NzE0ODgxNDg5MTQ5MjE0OTMxNDk0MTQ5NTE0OTYxNDk3' +
    'MTQ5ODE0OTkxNTE1MTYxNTE3MTUxODE1MTkxNTIyMTUyMzE1MjQxNTI1MTUyNjE1MjcxNTI4MTUyOTE1MzIxNTMzMTUzNDE1MzUxNTM2MTUzNzE1MzgxNTM5' +
    'MTU0MjE1NDMxNTQ0MTU0NTE1NDYxNTQ3MTU0ODE1NDkxNTUyMTU1MzE1NTQxNTU1MTU1NjE1NTcxNTU4MTU1OTE1NjIxNTYzMTU2NDE1NjUxNTY2MTU2NzE1' +
    'NjgxNTY5MTU3MjE1NzMxNTc0MTU3NTE1NzYxNTc3MTU3ODE1NzkxNTgyMTU4MzE1ODQxNTg1MTU4NjE1ODcxNTg4MTU4OTE1OTIxNTkzMTU5NDE1OTUxNTk2' +
    'MTU5NzE1OTgxNTk5MTYxNjE3MTYxODE2MTkxNjIyMTYyMzE2MjQxNjI1MTYyNjE2MjcxNjI4MTYyOTE2MzIxNjMzMTYzNDE2MzUxNjM2MTYzNzE2MzgxNjM5' +
    'MTY0MjE2NDMxNjQ0MTY0NTE2NDYxNjQ3MTY0ODE2NDkxNjUyMTY1MzE2NTQxNjU1MTY1NjE2NTcxNjU4MTY1OTE2NjIxNjYzMTY2NDE2NjUxNjY2MTY2NzE2' +
    'NjgxNjY5MTY3MjE2NzMxNjc0MTY3NTE2NzYxNjc3MTY3ODE2NzkxNjgyMTY4MzE2ODQxNjg1MTY4NjE2ODcxNjg4MTY4OTE2OTIxNjkzMTY5NDE2OTUxNjk2' +
    'MTY5NzE2OTgxNjk5MTcxNzE4MTcxOTE3MjIxNzIzMTcyNDE3MjUxNzI2MTcyNzE3MjgxNzI5MTczMjE3MzMxNzM0MTczNTE3MzYxNzM3MTczODE3MzkxNzQy' +
    'MTc0MzE3NDQxNzQ1MTc0NjE3NDcxNzQ4MTc0OTE3NTIxNzUzMTc1NDE3NTUxNzU2MTc1NzE3NTgxNzU5MTc2MjE3NjMxNzY0MTc2NTE3NjYxNzY3MTc2ODE3' +
    'NjkxNzcyMTc3MzE3NzQxNzc1MTc3NjE3NzcxNzc4MTc3OTE3ODIxNzgzMTc4NDE3ODUxNzg2MTc4NzE3ODgxNzg5MTc5MjE3OTMxNzk0MTc5NTE3OTYxNzk3' +
    'MTc5ODE3OTkxODE4MTkxODIyMTgyMzE4MjQxODI1MTgyNjE4MjcxODI4MTgyOTE4MzIxODMzMTgzNDE4MzUxODM2MTgzNzE4MzgxODM5MTg0MjE4NDMxODQ0' +
    'MTg0NTE4NDYxODQ3MTg0ODE4NDkxODUyMTg1MzE4NTQxODU1MTg1NjE4NTcxODU4MTg1OTE4NjIxODYzMTg2NDE4NjUxODY2MTg2NzE4NjgxODY5MTg3MjE4' +
    'NzMxODc0MTg3NTE4NzYxODc3MTg3ODE4NzkxODgyMTg4MzE4ODQxODg1MTg4NjE4ODcxODg4MTg4OTE4OTIxODkzMTg5NDE4OTUxODk2MTg5NzE4OTgxODk5' +
    'MTkxOTIyMTkyMzE5MjQxOTI1MTkyNjE5MjcxOTI4MTkyOTE5MzIxOTMzMTkzNDE5MzUxOTM2MTkzNzE5MzgxOTM5MTk0MjE5NDMxOTQ0MTk0NTE5NDYxOTQ3' +
    'MTk0ODE5NDkxOTUyMTk1MzE5NTQxOTU1MTk1NjE5NTcxOTU4MTk1OTE5NjIxOTYzMTk2NDE5NjUxOTY2MTk2NzE5NjgxOTY5MTk3MjE5NzMxOTc0MTk3NTE5' +
    'NzYxOTc3MTk3ODE5NzkxOTgyMTk4MzE5ODQxOTg1MTk4NjE5ODcxOTg4MTk4OTE5OTIxOTkzMTk5NDE5OTUxOTk2MTk5NzE5OTgxOTk5MjIyMjMyMjI0MjIy' +
    'NTIyMjYyMjI3MjIyODIyMjkyMjMzMjIzNDIyMzUyMjM2MjIzNzIyMzgyMjM5MjI0MzIyNDQyMjQ1MjI0NjIyNDcyMjQ4MjI0OTIyNTMyMjU0MjI1NTIyNTYy' +
    'MjU3MjI1ODIyNTkyMjYzMjI2NDIyNjUyMjY2MjI2NzIyNjgyMjY5MjI3MzIyNzQyMjc1MjI3NjIyNzcyMjc4MjI3OTIyODMyMjg0MjI4NTIyODYyMjg3MjI4' +
    'ODIyODkyMjkzMjI5NDIyOTUyMjk2MjI5NzIyOTgyMjk5MjMyMzI0MjMyNTIzMjYyMzI3MjMyODIzMjkyMzMzMjMzNDIzMzUyMzM2MjMzNzIzMzgyMzM5MjM0' +
    'MzIzNDQyMzQ1MjM0NjIzNDcyMzQ4MjM0OTIzNTMyMzU0MjM1NTIzNTYyMzU3MjM1ODIzNTkyMzYzMjM2NDIzNjUyMzY2MjM2NzIzNjgyMzY5MjM3MzIzNzQy' +
    'Mzc1MjM3NjIzNzcyMzc4MjM3OTIzODMyMzg0MjM4NTIzODYyMzg3MjM4ODIzODkyMzkzMjM5NDIzOTUyMzk2MjM5NzIzOTgyMzk5MjQyNDI1MjQyNjI0Mjcy' +
    'NDI4MjQyOTI0MzMyNDM0MjQzNTI0MzYyNDM3MjQzODI0MzkyNDQzMjQ0NDI0NDUyNDQ2MjQ0NzI0NDgyNDQ5MjQ1MzI0NTQyNDU1MjQ1NjI0NTcyNDU4MjQ1' +
    'OTI0NjMyNDY0MjQ2NTI0NjYyNDY3MjQ2ODI0NjkyNDczMjQ3NDI0NzUyNDc2MjQ3NzI0NzgyNDc5MjQ4MzI0ODQyNDg1MjQ4NjI0ODcyNDg4MjQ4OTI0OTMy' +
    'NDk0MjQ5NTI0OTYyNDk3MjQ5ODI0OTkyNTI1MjYyNTI3MjUyODI1MjkyNTMzMjUzNDI1MzUyNTM2MjUzNzI1MzgyNTM5MjU0MzI1NDQyNTQ1MjU0NjI1NDcy' +
    'NTQ4MjU0OTI1NTMyNTU0MjU1NTI1NTYyNTU3MjU1ODI1NTkyNTYzMjU2NDI1NjUyNTY2MjU2NzI1NjgyNTY5MjU3MzI1NzQyNTc1MjU3NjI1NzcyNTc4MjU3' +
    'OTI1ODMyNTg0MjU4NTI1ODYyNTg3MjU4ODI1ODkyNTkzMjU5NDI1OTUyNTk2MjU5NzI1OTgyNTk5MjYyNjI3MjYyODI2MjkyNjMzMjYzNDI2MzUyNjM2MjYz' +
    'NzI2MzgyNjM5MjY0MzI2NDQyNjQ1MjY0NjI2NDcyNjQ4MjY0OTI2NTMyNjU0MjY1NTI2NTYyNjU3MjY1ODI2NTkyNjYzMjY2NDI2NjUyNjY2MjY2NzI2Njgy' +
    'NjY5MjY3MzI2NzQyNjc1MjY3NjI2NzcyNjc4MjY3OTI2ODMyNjg0MjY4NTI2ODYyNjg3MjY4ODI2ODkyNjkzMjY5NDI2OTUyNjk2MjY5NzI2OTgyNjk5Mjcy' +
    'NzI4MjcyOTI3MzMyNzM0MjczNTI3MzYyNzM3MjczODI3MzkyNzQzMjc0NDI3NDUyNzQ2Mjc0NzI3NDgyNzQ5Mjc1MzI3NTQyNzU1Mjc1NjI3NTcyNzU4Mjc1' +
    'OTI3NjMyNzY0Mjc2NTI3NjYyNzY3Mjc2ODI3NjkyNzczMjc3NDI3NzUyNzc2Mjc3NzI3NzgyNzc5Mjc4MzI3ODQyNzg1Mjc4NjI3ODcyNzg4Mjc4OTI3OTMy' +
    'Nzk0Mjc5NTI3OTYyNzk3Mjc5ODI3OTkyODI4MjkyODMzMjgzNDI4MzUyODM2MjgzNzI4MzgyODM5Mjg0MzI4NDQyODQ1Mjg0NjI4NDcyODQ4Mjg0OTI4NTMy' +
    'ODU0Mjg1NTI4NTYyODU3Mjg1ODI4NTkyODYzMjg2NDI4NjUyODY2Mjg2NzI4NjgyODY5Mjg3MzI4NzQyODc1Mjg3NjI4NzcyODc4Mjg3OTI4ODMyODg0Mjg4' +
    'NTI4ODYyODg3Mjg4ODI4ODkyODkzMjg5NDI4OTUyODk2Mjg5NzI4OTgyODk5MjkyOTMzMjkzNDI5MzUyOTM2MjkzNzI5MzgyOTM5Mjk0MzI5NDQyOTQ1Mjk0' +
    'NjI5NDcyOTQ4Mjk0OTI5NTMyOTU0Mjk1NTI5NTYyOTU3Mjk1ODI5NTkyOTYzMjk2NDI5NjUyOTY2Mjk2NzI5NjgyOTY5Mjk3MzI5NzQyOTc1Mjk3NjI5Nzcy' +
    'OTc4Mjk3OTI5ODMyOTg0Mjk4NTI5ODYyOTg3Mjk4ODI5ODkyOTkzMjk5NDI5OTUyOTk2Mjk5NzI5OTgyOTk5MzMzMzQzMzM1MzMzNjMzMzczMzM4MzMzOTMz' +
    'NDQzMzQ1MzM0NjMzNDczMzQ4MzM0OTMzNTQzMzU1MzM1NjMzNTczMzU4MzM1OTMzNjQzMzY1MzM2NjMzNjczMzY4MzM2OTMzNzQzMzc1MzM3NjMzNzczMzc4' +
    'MzM3OTMzODQzMzg1MzM4NjMzODczMzg4MzM4OTMzOTQzMzk1MzM5NjMzOTczMzk4MzM5OTM0MzQzNTM0MzYzNDM3MzQzODM0MzkzNDQ0MzQ0NTM0NDYzNDQ3' +
    'MzQ0ODM0NDkzNDU0MzQ1NTM0NTYzNDU3MzQ1ODM0NTkzNDY0MzQ2NTM0NjYzNDY3MzQ2ODM0NjkzNDc0MzQ3NTM0NzYzNDc3MzQ3ODM0NzkzNDg0MzQ4NTM0' +
    'ODYzNDg3MzQ4ODM0ODkzNDk0MzQ5NTM0OTYzNDk3MzQ5ODM0OTkzNTM1MzYzNTM3MzUzODM1MzkzNTQ0MzU0NTM1NDYzNTQ3MzU0ODM1NDkzNTU0MzU1NTM1' +
    'NTYzNTU3MzU1ODM1NTkzNTY0MzU2NTM1NjYzNTY3MzU2ODM1NjkzNTc0MzU3NTM1NzYzNTc3MzU3ODM1NzkzNTg0MzU4NTM1ODYzNTg3MzU4ODM1ODkzNTk0' +
    'MzU5NTM1OTYzNTk3MzU5ODM1OTkzNjM2MzczNjM4MzYzOTM2NDQzNjQ1MzY0NjM2NDczNjQ4MzY0OTM2NTQzNjU1MzY1NjM2NTczNjU4MzY1OTM2NjQzNjY1' +
    'MzY2NjM2NjczNjY4MzY2OTM2NzQzNjc1MzY3NjM2NzczNjc4MzY3OTM2ODQzNjg1MzY4NjM2ODczNjg4MzY4OTM2OTQzNjk1MzY5NjM2OTczNjk4MzY5OTM3' +
    'MzczODM3MzkzNzQ0Mzc0NTM3NDYzNzQ3Mzc0ODM3NDkzNzU0Mzc1NTM3NTYzNzU3Mzc1ODM3NTkzNzY0Mzc2NTM3NjYzNzY3Mzc2ODM3NjkzNzc0Mzc3NTM3' +
    'NzYzNzc3Mzc3ODM3NzkzNzg0Mzc4NTM3ODYzNzg3Mzc4ODM3ODkzNzk0Mzc5NTM3OTYzNzk3Mzc5ODM3OTkzODM4MzkzODQ0Mzg0NTM4NDYzODQ3Mzg0ODM4' +
    'NDkzODU0Mzg1NTM4NTYzODU3Mzg1ODM4NTkzODY0Mzg2NTM4NjYzODY3Mzg2ODM4NjkzODc0Mzg3NTM4NzYzODc3Mzg3ODM4NzkzODg0Mzg4NTM4ODYzODg3' +
    'Mzg4ODM4ODkzODk0Mzg5NTM4OTYzODk3Mzg5ODM4OTkzOTM5NDQzOTQ1Mzk0NjM5NDczOTQ4Mzk0OTM5NTQzOTU1Mzk1NjM5NTczOTU4Mzk1OTM5NjQzOTY1' +
    'Mzk2NjM5NjczOTY4Mzk2OTM5NzQzOTc1Mzk3NjM5NzczOTc4Mzk3OTM5ODQzOTg1Mzk4NjM5ODczOTg4Mzk4OTM5OTQzOTk1Mzk5NjM5OTczOTk4Mzk5OTQ0' +
    'NDQ1NDQ0NjQ0NDc0NDQ4NDQ0OTQ0NTU0NDU2NDQ1NzQ0NTg0NDU5NDQ2NTQ0NjY0NDY3NDQ2ODQ0Njk0NDc1NDQ3NjQ0Nzc0NDc4NDQ3OTQ0ODU0NDg2NDQ4' +
    'NzQ0ODg0NDg5NDQ5NTQ0OTY0NDk3NDQ5ODQ0OTk0NTQ1NDY0NTQ3NDU0ODQ1NDk0NTU1NDU1NjQ1NTc0NTU4NDU1OTQ1NjU0NTY2NDU2NzQ1Njg0NTY5NDU3' +
    'NTQ1NzY0NTc3NDU3ODQ1Nzk0NTg1NDU4NjQ1ODc0NTg4NDU4OTQ1OTU0NTk2NDU5NzQ1OTg0NTk5NDY0NjQ3NDY0ODQ2NDk0NjU1NDY1NjQ2NTc0NjU4NDY1' +
    'OTQ2NjU0NjY2NDY2NzQ2Njg0NjY5NDY3NTQ2NzY0Njc3NDY3ODQ2Nzk0Njg1NDY4NjQ2ODc0Njg4NDY4OTQ2OTU0Njk2NDY5NzQ2OTg0Njk5NDc0NzQ4NDc0' +
    'OTQ3NTU0NzU2NDc1NzQ3NTg0NzU5NDc2NTQ3NjY0NzY3NDc2ODQ3Njk0Nzc1NDc3NjQ3Nzc0Nzc4NDc3OTQ3ODU0Nzg2NDc4NzQ3ODg0Nzg5NDc5NTQ3OTY0' +
    'Nzk3NDc5ODQ3OTk0ODQ4NDk0ODU1NDg1NjQ4NTc0ODU4NDg1OTQ4NjU0ODY2NDg2NzQ4Njg0ODY5NDg3NTQ4NzY0ODc3NDg3ODQ4Nzk0ODg1NDg4NjQ4ODc0' +
    'ODg4NDg4OTQ4OTU0ODk2NDg5NzQ4OTg0ODk5NDk0OTU1NDk1NjQ5NTc0OTU4NDk1OTQ5NjU0OTY2NDk2NzQ5Njg0OTY5NDk3NTQ5NzY0OTc3NDk3ODQ5Nzk0' +
    'OTg1NDk4NjQ5ODc0OTg4NDk4OTQ5OTU0OTk2NDk5NzQ5OTg0OTk5NTU1NTY1NTU3NTU1ODU1NTk1NTY2NTU2NzU1Njg1NTY5NTU3NjU1Nzc1NTc4NTU3OTU1' +
    'ODY1NTg3NTU4ODU1ODk1NTk2NTU5NzU1OTg1NTk5NTY1NjU3NTY1ODU2NTk1NjY2NTY2NzU2Njg1NjY5NTY3NjU2Nzc1Njc4NTY3OTU2ODY1Njg3NTY4ODU2' +
    'ODk1Njk2NTY5NzU2OTg1Njk5NTc1NzU4NTc1OTU3NjY1NzY3NTc2ODU3Njk1Nzc2NTc3NzU3Nzg1Nzc5NTc4NjU3ODc1Nzg4NTc4OTU3OTY1Nzk3NTc5ODU3' +
    'OTk1ODU4NTk1ODY2NTg2NzU4Njg1ODY5NTg3NjU4Nzc1ODc4NTg3OTU4ODY1ODg3NTg4ODU4ODk1ODk2NTg5NzU4OTg1ODk5NTk1OTY2NTk2NzU5Njg1OTY5' +
    'NTk3NjU5Nzc1OTc4NTk3OTU5ODY1OTg3NTk4ODU5ODk1OTk2NTk5NzU5OTg1OTk5NjY2Njc2NjY4NjY2OTY2Nzc2Njc4NjY3OTY2ODc2Njg4NjY4OTY2OTc2' +
    'Njk4NjY5OTY3Njc2ODY3Njk2Nzc3Njc3ODY3Nzk2Nzg3Njc4ODY3ODk2Nzk3Njc5ODY3OTk2ODY4Njk2ODc3Njg3ODY4Nzk2ODg3Njg4ODY4ODk2ODk3Njg5' +
    'ODY4OTk2OTY5Nzc2OTc4Njk3OTY5ODc2OTg4Njk4OTY5OTc2OTk4Njk5OTc3Nzc4Nzc3OTc3ODg3Nzg5Nzc5ODc3OTk3ODc4Nzk3ODg4Nzg4OTc4OTg3ODk5' +
    'Nzk3OTg4Nzk4OTc5OTg3OTk5ODg4ODk4ODk5ODk4OTk5OTAwMHsEBAAAAQAA/////wAA//8A////AP8A////AP//AAD//wD//wAAAP+AgID/wMDA/wAA//9/' +
    'f///AACl/1JSpf8AAH//Pz9//wAATP8mJkz/AAAm/xMTJv8AP///f5///wAppf9SZ6X/AB9//z9Pf/8AE0z/Ji9M/wAJJv8TFyb/AH///3+///8AUqX/Unyl' +
    '/wA/f/8/X3//ACZM/yY5TP8AEyb/Exwm/wC///9/3///AHyl/1KRpf8AX3//P29//wA5TP8mQkz/ABwm/xMhJv8A////f////wClpf9SpaX/AH9//z9/f/8A' +
    'TEz/JkxM/wAmJv8TJib/AP+//3//3/8ApXz/UqWR/wB/X/8/f2//AEw5/yZMQv8AJhz/EyYh/wD/f/9//7//AKVS/1KlfP8Afz//P39f/wBMJv8mTDn/ACYT' +
    '/xMmHP8A/z//f/+f/wClKf9SpWf/AH8f/z9/T/8ATBP/Jkwv/wAmCf8TJhf/AP8A/3//f/8ApQD/UqVS/wB/AP8/fz//AEwA/yZMJv8AJgD/EyYT/z//AP+f' +
    '/3//KaUA/2elUv8ffwD/T38//xNMAP8vTCb/CSYA/xcmE/9//wD/v/9//1KlAP98pVL/P38A/19/P/8mTAD/OUwm/xMmAP8cJhP/v/8A/9//f/98pQD/kaVS' +
    '/19/AP9vfz//OUwA/0JMJv8cJgD/ISYT////AP///3//paUA/6WlUv9/fwD/f38//0xMAP9MTCb/JiYA/yYmE///vwD//99//6V8AP+lkVL/f18A/39vP/9M' +
    'OQD/TEIm/yYcAP8mIRP//38A//+/f/+lUgD/pXxS/38/AP9/Xz//TCYA/0w5Jv8mEwD/JhwT//8/AP//n3//pSkA/6VnUv9/HwD/f08//0wTAP9MLyb/JgkA' +
    '/yYXE///AAD//39//6UAAP+lUlL/fwAA/38/P/9MAAD/TCYm/yYAAP8mExP//wA///9/n/+lACn/pVJn/38AH/9/P0//TAAT/0wmL/8mAAn/JhMX//8Af///' +
    'f7//pQBS/6VSfP9/AD//fz9f/0wAJv9MJjn/JgAT/yYTHP//AL///3/f/6UAfP+lUpH/fwBf/38/b/9MADn/TCZC/yYAHP8mEyH//wD///9///+lAKX/pVKl' +
    '/38Af/9/P3//TABM/0wmTP8mACb/JhMm/78A///ff///fACl/5FSpf9fAH//bz9//zkATP9CJkz/HAAm/yETJv9/AP//v3///1IApf98UqX/PwB//18/f/8m' +
    'AEz/OSZM/xMAJv8cEyb/PwD//59///8pAKX/Z1Kl/x8Af/9PP3//EwBM/y8mTP8JACb/FxMm/wAAAP8tLS3/W1tb/4mJif+3t7f/s7Oz/wAAAP8AAP//AP//' +
    '/wD/AP///wD//wAA//8A////////gICA/8DAwP8AAP//f3///wAAzP9mZsz/AACZ/0xMmf8AAH//Pz9//wAATP8mJkz/AD///3+f//8AM8z/Zn/M/wAmmf9M' +
    'X5n/AB9//z9Pf/8AE0z/Ji9M/wB///9/v///AGbM/2aZzP8ATJn/THKZ/wA/f/8/X3//ACZM/yY5TP8Av///f9///wCZzP9mssz/AHKZ/0yFmf8AX3//P29/' +
    '/wA5TP8mQkz/AP///3////8AzMz/ZszM/wCZmf9MmZn/AH9//z9/f/8ATEz/JkxM/wD/v/9//9//AMyZ/2bMsv8AmXL/TJmF/wB/X/8/f2//AEw5/yZMQv8A' +
    '/3//f/+//wDMZv9mzJn/AJlM/0yZcv8Afz//P39f/wBMJv8mTDn/AP8//3//n/8AzDP/Zsx//wCZJv9MmV//AH8f/z9/T/8ATBP/Jkwv/wD/AP9//3//AMwA' +
    '/2bMZv8AmQD/TJlM/wB/AP8/fz//AEwA/yZMJv8//wD/n/9//zPMAP9/zGb/JpkA/1+ZTP8ffwD/T38//xNMAP8vTCb/f/8A/7//f/9mzAD/mcxm/0yZAP9y' +
    'mUz/P38A/19/P/8mTAD/OUwm/7//AP/f/3//mcwA/7LMZv9ymQD/hZlM/19/AP9vfz//OUwA/0JMJv///wD///9//8zMAP/MzGb/mZkA/5mZTP9/fwD/f38/' +
    '/0xMAP9MTCb//78A///ff//MmQD/zLJm/5lyAP+ZhUz/f18A/39vP/9MOQD/TEIm//9/AP//v3//zGYA/8yZZv+ZTAD/mXJM/38/AP9/Xz//TCYA/0w5Jv//' +
    'PwD//59//8wzAP/Mf2b/mSYA/5lfTP9/HwD/f08//0wTAP9MLyb//wAA//9/f//MAAD/zGZm/5kAAP+ZTEz/fwAA/38/P/9MAAD/TCYm//8AP///f5//zAAz' +
    '/8xmf/+ZACb/mUxf/38AH/9/P0//TAAT/0wmL///AH///3+//8wAZv/MZpn/mQBM/5lMcv9/AD//fz9f/0wAJv9MJjn//wC///9/3//MAJn/zGay/5kAcv+Z' +
    'TIX/fwBf/38/b/9MADn/TCZC//8A////f///zADM/8xmzP+ZAJn/mUyZ/38Af/9/P3//TABM/0wmTP+/AP//33///5kAzP+yZsz/cgCZ/4VMmf9fAH//bz9/' +
    '/zkATP9CJkz/fwD//79///9mAMz/mWbM/0wAmf9yTJn/PwB//18/f/8mAEz/OSZM/z8A//+ff///MwDM/39mzP8mAJn/X0yZ/x8Af/9PP3//EwBM/y8mTP8z' +
    'MzP/W1tb/4SEhP+tra3/1tbW//////8=';

  var TWO_PI = Math.PI * 2;
  var ANG = TWO_PI / 65536;          // WHIP angles are 1/65536 of a full turn

  // ---------------------------------------------------------------------------
  // small utilities
  // ---------------------------------------------------------------------------
  function b64decode(s) {
    if (typeof atob === 'function') {
      var bin = atob(s), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    }
    return new Uint8Array(Buffer.from(s, 'base64')); // eslint-disable-line no-undef
  }

  var _preload = null;
  function preload() { return _preload || (_preload = b64decode(PRELOAD_B64)); }
  // zlib preset dictionary: WD_History_Buffer_Preload_Size - 2048, where Size
  // includes the C string terminator (see lz77decp.cpp / lzdefs.h).
  function zlibDict() { var p = preload(); return p.subarray(0, p.length + 1 - 2048); }

  function palette(hex) {
    var a = new Array(256);
    for (var i = 0; i < 256; i++) {
      var v = parseInt(hex.substr(i * 6, 6), 16);
      a[i] = [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
    }
    return a;
  }

  // Windows-1252 code points for 0x80..0x9F (WHIP ASCII strings are 8-bit ANSI)
  var CP1252 = [0x20AC, 0x81, 0x201A, 0x192, 0x201E, 0x2026, 0x2020, 0x2021, 0x2C6, 0x2030, 0x160, 0x2039, 0x152, 0x8D, 0x17D, 0x8F,
    0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x2DC, 0x2122, 0x161, 0x203A, 0x153, 0x9D, 0x17E, 0x178];
  function ansiString(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) {
      var c = bytes[i];
      s += String.fromCharCode(c >= 0x80 && c < 0xA0 ? CP1252[c - 0x80] : c);
    }
    return s;
  }

  function cssColor(c) {
    var a = c[3];
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a === 255 ? '1' : +(a / 255).toFixed(3)) + ')';
  }

  // ---------------------------------------------------------------------------
  // inflate (RFC 1950/1951) with preset dictionary support.  WHIP zlib blocks
  // use FDICT with the WHIP preload as dictionary, which DecompressionStream
  // cannot handle, so we carry our own decoder.  Returns the decompressed bytes
  // and the input offset just past the zlib stream (adler32 included).
  // ---------------------------------------------------------------------------
  var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLORD = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  // Table entries: (symbol << 4) | codeLength ; indexed by the next maxBits input bits
  function huffTable(lens, n) {
    var maxBits = 0, i;
    for (i = 0; i < n; i++) if (lens[i] > maxBits) maxBits = lens[i];
    if (maxBits === 0) return { tab: new Int32Array(2), bits: 1 };
    var count = new Int32Array(16), next = new Int32Array(16);
    for (i = 0; i < n; i++) count[lens[i]]++;
    count[0] = 0;
    var code = 0;
    for (i = 1; i <= 15; i++) { code = (code + count[i - 1]) << 1; next[i] = code; }
    var size = 1 << maxBits, tab = new Int32Array(size);
    for (i = 0; i < n; i++) {
      var l = lens[i];
      if (!l) continue;
      var c = next[l]++, r = 0;
      for (var k = 0; k < l; k++) { r = (r << 1) | (c & 1); c >>= 1; }
      var e = (i << 4) | l;
      for (var j = r; j < size; j += (1 << l)) tab[j] = e;
    }
    return { tab: tab, bits: maxBits };
  }

  var FIXED = null;
  function fixedTables() {
    if (FIXED) return FIXED;
    var l = new Uint8Array(288), i;
    for (i = 0; i < 144; i++) l[i] = 8;
    for (; i < 256; i++) l[i] = 9;
    for (; i < 280; i++) l[i] = 7;
    for (; i < 288; i++) l[i] = 8;
    var d = new Uint8Array(32);
    for (i = 0; i < 32; i++) d[i] = 5;
    FIXED = [huffTable(l, 288), huffTable(d, 32)];
    return FIXED;
  }

  function inflateZlib(src, start, dict) {
    var p = start, n = src.length;
    var cmf = src[p++], flg = src[p++];
    if ((cmf & 15) !== 8 || ((cmf << 8) | flg) % 31) throw new Error('bad zlib header');
    var dl = 0;
    if (flg & 0x20) { p += 4; dl = dict.length; }
    var out = new Uint8Array(Math.max(1 << 16, (n - start) * 6) + dl);
    if (dl) out.set(dict);
    var op = dl, bb = 0, bc = 0, fin = 0;
    function grow(need) {
      var cap = out.length;
      while (cap < op + need) cap *= 2;
      var o = new Uint8Array(cap); o.set(out.subarray(0, op)); out = o;
    }
    do {
      while (bc < 3) { bb |= (src[p++] | 0) << bc; bc += 8; }
      fin = bb & 1;
      var type = (bb >>> 1) & 3;
      bb >>>= 3; bc -= 3;
      if (type === 0) {
        p -= bc >> 3; bb = 0; bc = 0;
        var len = src[p] | (src[p + 1] << 8);
        p += 4;
        if (op + len > out.length) grow(len);
        out.set(src.subarray(p, p + len), op);
        op += len; p += len;
        continue;
      }
      var lt, dt;
      if (type === 1) { var f = fixedTables(); lt = f[0]; dt = f[1]; }
      else if (type === 2) {
        while (bc < 14) { bb |= (src[p++] | 0) << bc; bc += 8; }
        var hlit = (bb & 31) + 257, hdist = ((bb >>> 5) & 31) + 1, hclen = ((bb >>> 10) & 15) + 4;
        bb >>>= 14; bc -= 14;
        var cl = new Uint8Array(19), i;
        for (i = 0; i < hclen; i++) {
          while (bc < 3) { bb |= (src[p++] | 0) << bc; bc += 8; }
          cl[CLORD[i]] = bb & 7; bb >>>= 3; bc -= 3;
        }
        var ct = huffTable(cl, 19), ctab = ct.tab, cbits = ct.bits, cmask = (1 << cbits) - 1;
        var lens = new Uint8Array(hlit + hdist);
        i = 0;
        while (i < hlit + hdist) {
          while (bc < 16) { bb |= (src[p++] | 0) << bc; bc += 8; }
          var e = ctab[bb & cmask], sym = e >>> 4, sl = e & 15;
          if (!sl) throw new Error('bad code length code');
          bb >>>= sl; bc -= sl;
          if (sym < 16) lens[i++] = sym;
          else {
            var rep, val = 0;
            while (bc < 7) { bb |= (src[p++] | 0) << bc; bc += 8; }
            if (sym === 16) { if (!i) throw new Error('bad repeat'); val = lens[i - 1]; rep = 3 + (bb & 3); bb >>>= 2; bc -= 2; }
            else if (sym === 17) { rep = 3 + (bb & 7); bb >>>= 3; bc -= 3; }
            else { rep = 11 + (bb & 127); bb >>>= 7; bc -= 7; }
            while (rep-- && i < hlit + hdist) lens[i++] = val;
          }
        }
        lt = huffTable(lens.subarray(0, hlit), hlit);
        dt = huffTable(lens.subarray(hlit), hdist);
      } else throw new Error('bad deflate block type');

      var ltab = lt.tab, lbits = lt.bits, lmask = (1 << lbits) - 1;
      var dtab = dt.tab, dbits = dt.bits, dmask = (1 << dbits) - 1;
      for (;;) {
        while (bc < 15) { bb |= (src[p++] | 0) << bc; bc += 8; }
        var le = ltab[bb & lmask], ls = le & 15;
        if (!ls) throw new Error('bad literal code');
        bb >>>= ls; bc -= ls;
        var s = le >>> 4;
        if (s < 256) {
          if (op >= out.length) grow(1);
          out[op++] = s;
          continue;
        }
        if (s === 256) break;
        s -= 257;
        var eb = LEXT[s], L = LBASE[s];
        if (eb) {
          while (bc < eb) { bb |= (src[p++] | 0) << bc; bc += 8; }
          L += bb & ((1 << eb) - 1); bb >>>= eb; bc -= eb;
        }
        while (bc < 15) { bb |= (src[p++] | 0) << bc; bc += 8; }
        var de = dtab[bb & dmask], ds = de & 15;
        if (!ds) throw new Error('bad distance code');
        bb >>>= ds; bc -= ds;
        var dsym = de >>> 4, D = DBASE[dsym], deb = DEXT[dsym];
        if (deb) {
          while (bc < deb) { bb |= (src[p++] | 0) << bc; bc += 8; }
          D += bb & ((1 << deb) - 1); bb >>>= deb; bc -= deb;
        }
        if (D > op) throw new Error('distance too far back');
        if (op + L > out.length) grow(L);
        var from = op - D;
        for (var k = 0; k < L; k++) out[op++] = out[from++];
      }
    } while (!fin);
    p -= bc >> 3;               // give back whole bytes we pre-fetched
    if (p > n) throw new Error('truncated zlib stream');
    p += 4;                     // adler32
    return { out: out.subarray(dl, op), end: p };
  }

  // Old WHIP LZ compression (lz77decp.cpp, WT_LZ_DeCompressor)
  function inflateWhipLZ(src, start, rev) {
    var pre = rev >= 23 ? preload() : new Uint8Array(0);
    var hl = pre.length, n = src.length;
    var out = new Uint8Array(Math.max(1 << 16, (n - start) * 4) + hl);
    out.set(pre);
    var op = hl, p = start;
    function grow(need) {
      var cap = out.length;
      while (cap < op + need) cap *= 2;
      var o = new Uint8Array(cap); o.set(out.subarray(0, op)); out = o;
    }
    for (;;) {
      if (p >= n) throw new Error('truncated LZ stream');
      var c = src[p++];
      if (!c) break;
      var lit = c & 15, comp = c >> 4;
      if (lit) {
        if (lit === 15) lit += src[p++];
        if (op + lit > out.length) grow(lit);
        out.set(src.subarray(p, p + lit), op); op += lit; p += lit;
      }
      if (comp) {
        if (comp === 15) comp = 18 + src[p++]; else comp += 3;
        var off = src[p] | (src[p + 1] << 8); p += 2;
        var size = Math.min(op, 65536);
        var from = rev >= 23 ? op - 1 - off : op - size + off;
        if (from < 0) throw new Error('bad LZ offset');
        if (op + comp > out.length) grow(comp);
        for (var k = 0; k < comp; k++) out[op++] = out[from++];
      }
    }
    return { out: out.subarray(hl, op), end: p };
  }

  // ---------------------------------------------------------------------------
  // CCITT Group 4 (T.6) decoder for 'Group4' / 'group 4X' images.
  // Returns Uint8Array of 0 (white) / 1 (black) per pixel, rows top first.
  // ---------------------------------------------------------------------------
  var G4_WT = '00110101 000111 0111 1000 1011 1100 1110 1111 10011 10100 00111 01000 001000 000011 110100 110101 101010 101011 0100111 0001100 0001000 0010111 0000011 0000100 0101000 0101011 0010011 0100100 0011000 00000010 00000011 00011010 00011011 00010010 00010011 00010100 00010101 00010110 00010111 00101000 00101001 00101010 00101011 00101100 00101101 00000100 00000101 00001010 00001011 01010010 01010011 01010100 01010101 00100100 00100101 01011000 01011001 01011010 01011011 01001010 01001011 00110010 00110011 00110100';
  var G4_WM = '11011 10010 010111 0110111 00110110 00110111 01100100 01100101 01101000 01100111 011001100 011001101 011010010 011010011 011010100 011010101 011010110 011010111 011011000 011011001 011011010 011011011 010011000 010011001 010011010 011000 010011011';
  var G4_BT = '0000110111 010 11 10 011 0011 0010 00011 000101 000100 0000100 0000101 0000111 00000100 00000111 000011000 0000010111 0000011000 0000001000 00001100111 00001101000 00001101100 00000110111 00000101000 00000010111 00000011000 000011001010 000011001011 000011001100 000011001101 000001101000 000001101001 000001101010 000001101011 000011010010 000011010011 000011010100 000011010101 000011010110 000011010111 000001101100 000001101101 000011011010 000011011011 000001010100 000001010101 000001010110 000001010111 000001100100 000001100101 000001010010 000001010011 000000100100 000000110111 000000111000 000000100111 000000101000 000001011000 000001011001 000000101011 000000101100 000001011010 000001100110 000001100111';
  var G4_BM = '0000001111 000011001000 000011001001 000001011011 000000110011 000000110100 000000110101 0000001101100 0000001101101 0000001001010 0000001001011 0000001001100 0000001001101 0000001110010 0000001110011 0000001110100 0000001110101 0000001110110 0000001110111 0000001010010 0000001010011 0000001010100 0000001010101 0000001011010 0000001011011 0000001100100 0000001100101';
  var G4_XM = '00000001000 00000001100 00000001101 000000010010 000000010011 000000010100 000000010101 000000010110 000000010111 000000011100 000000011101 000000011110 000000011111';
  var G4_TABLES = null;
  function g4Tables() {
    if (G4_TABLES) return G4_TABLES;
    function build(term, makeup) {
      var m = {};
      function put(list, f) { list.split(' ').forEach(function (c, i) { m[(c.length << 16) | parseInt(c, 2)] = f(i); }); }
      put(term, function (i) { return i; });
      put(makeup, function (i) { return (i + 1) * 64; });
      put(G4_XM, function (i) { return 1792 + i * 64; });
      return m;
    }
    G4_TABLES = [build(G4_WT, G4_WM), build(G4_BT, G4_BM)];
    return G4_TABLES;
  }
  function decodeG4(d, w, h) {
    var T = g4Tables(), out = new Uint8Array(w * h);
    var bytePos = 0, bitPos = 0, nbits = d.length * 8;
    function bit() {
      if (bytePos >= d.length) throw new ParseError('G4 data exhausted');
      var v = (d[bytePos] >> (7 - bitPos)) & 1;
      if (++bitPos === 8) { bitPos = 0; bytePos++; }
      return v;
    }
    function run(color) {
      var tab = T[color], total = 0;
      for (;;) {
        var code = 0, len = 0, v;
        for (;;) {
          code = (code << 1) | bit(); len++;
          v = tab[(len << 16) | code];
          if (v !== undefined) break;
          if (len > 13) throw new ParseError('bad G4 run code');
        }
        total += v;
        if (v < 64) return total;
      }
    }
    var ref = [w, w], cur;
    for (var y = 0; y < h; y++) {
      cur = [];
      var a0 = -1, color = 0, row = y * w, i = 0;
      while (a0 < w) {
        // b1: first changing element on ref line > a0 with colour opposite to a0's
        var st = a0 < 0 ? 0 : a0 + 1;
        while (i > 0 && ref[i - 1] >= st) i--;
        while (i < ref.length && (ref[i] < st || (i & 1) !== color)) i++;
        var b1 = i < ref.length ? ref[i] : w, b2 = i + 1 < ref.length ? ref[i + 1] : w;
        var mode, s = a0 < 0 ? 0 : a0;
        // read mode code
        if (bit()) mode = 0;                                  // V0: 1
        else if (bit()) mode = bit() ? 1 : -1;                // VR1 011 / VL1 010
        else if (bit()) mode = 10;                            // H: 001
        else if (bit()) mode = 11;                            // P: 0001
        else if (bit()) mode = bit() ? 2 : -2;                // VR2 000011 / VL2 000010
        else if (bit()) mode = bit() ? 3 : -3;                // VR3 0000011 / VL3 0000010
        else throw new ParseError('unsupported G4 mode (extension/EOFB)');
        if (mode === 11) {
          if (color) for (var k = s; k < b2; k++) out[row + k] = 1;
          a0 = b2;
        } else if (mode === 10) {
          var r1 = run(color), r2 = run(color ^ 1);
          var a1 = Math.min(s + r1, w), a2 = Math.min(a1 + r2, w);
          if (color) { for (k = s; k < a1; k++) out[row + k] = 1; }
          else { for (k = a1; k < a2; k++) out[row + k] = 1; }
          cur.push(a1, a2);
          a0 = a2;
        } else {
          var a = Math.min(Math.max(b1 + mode, 0), w);
          if (color) for (k = s; k < a; k++) out[row + k] = 1;
          cur.push(a);
          a0 = a; color ^= 1;
        }
      }
      cur.push(w, w);
      ref = cur;
    }
    return out;
  }

  // Minimal bilevel TIFF reader (WHIP 'group 4X' images carry a TIFF file).
  // Supports compression 1 (none), 4 (CCITT G4), 32773 (PackBits).
  // Returns { w, h, bits: Uint8Array of raw sample values 0/1, photometric }.
  function readBilevelTiff(d) {
    var le = d[0] === 0x49;
    var v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    function u16(o) { return v.getUint16(o, le); }
    function u32(o) { return v.getUint32(o, le); }
    var ifd = u32(4), n = u16(ifd), tags = {};
    for (var k = 0; k < n; k++) {
      var e = ifd + 2 + k * 12, tag = u16(e), type = u16(e + 2), cnt = u32(e + 4);
      var sz = type === 3 ? 2 : 4, off = cnt * sz > 4 ? u32(e + 8) : e + 8, vals = [];
      for (var j = 0; j < cnt; j++) vals.push(sz === 2 ? u16(off + j * 2) : u32(off + j * 4));
      tags[tag] = vals;
    }
    var w = tags[256][0], h = tags[257][0], comp = tags[259] ? tags[259][0] : 1;
    var bps = tags[258] ? tags[258][0] : 1;
    if (bps !== 1) throw new ParseError('TIFF with ' + bps + ' bits/sample');
    var offs = tags[273], cnts = tags[279], rps = tags[278] ? tags[278][0] : h;
    var fill = tags[266] ? tags[266][0] : 1;
    var bits = new Uint8Array(w * h), stride = (w + 7) >> 3, y0 = 0;
    for (var s = 0; s < offs.length && y0 < h; s++) {
      var rows = Math.min(rps, h - y0), raw = d.subarray(offs[s], offs[s] + cnts[s]);
      if (fill === 2) { var rr = new Uint8Array(raw.length); for (var q = 0; q < raw.length; q++) { var x = raw[q], r = 0; for (var t = 0; t < 8; t++) r |= ((x >> t) & 1) << (7 - t); rr[q] = r; } raw = rr; }
      if (comp === 4) {
        bits.set(decodeG4(raw, w, rows), y0 * w);
      } else {
        var buf = raw;
        if (comp === 32773) {
          buf = new Uint8Array(stride * rows);
          for (var ip = 0, op = 0; ip < raw.length && op < buf.length;) {
            var c = raw[ip++];
            if (c < 128) { for (var m = 0; m <= c; m++) buf[op++] = raw[ip++]; }
            else if (c > 128) { var bv = raw[ip++]; for (m = 0; m < 257 - c; m++) buf[op++] = bv; }
          }
        } else if (comp !== 1) throw new ParseError('TIFF compression ' + comp);
        for (var yy = 0; yy < rows; yy++)
          for (var xx = 0; xx < w; xx++)
            bits[(y0 + yy) * w + xx] = (buf[yy * stride + (xx >> 3)] >> (7 - (xx & 7))) & 1;
      }
      y0 += rows;
    }
    return { w: w, h: h, bits: bits, photometric: tags[262] ? tags[262][0] : 0 };
  }

  // ---------------------------------------------------------------------------
  // the parser
  // ---------------------------------------------------------------------------
  function ParseError(msg) { this.message = msg; }

  function parseSync(input) {
    var b = input, n = b.length, p = 0;
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);

    var items = [], layers = {}, warnCounts = {}, warnOrder = [];
    var clips = [];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var result = { bounds: null, items: items, layers: layers, warnings: [] };

    // ---- rendition state ----
    var rev = 600;
    var cx = 0, cy = 0;                           // current point for relative coords
    var cmap = palette(PAL_NEW);
    var color = [255, 255, 255, 255], colorStr = cssColor(color);
    var fill = false, visible = true, lw = 0, layer = null, clip = -1;
    var font = { name: '', height: 0, rot: 0, widthScale: 1024, spacing: 1024, oblique: 0, flags: 0, bold: false, italic: false, underline: false, charset: 1, pitch: 0, family: 0 };
    var halign = 0, valign = 1;                   // Left, Baseline
    var markerSize = 0, markerSymbol = 0, macroIndex = 0, macroScale = 0;
    var done = false, compressed = false;

    function warn(key) {
      if (!warnCounts[key]) { warnCounts[key] = 0; warnOrder.push(key); }
      warnCounts[key]++;
    }
    function setColor(c) { color = c; colorStr = cssColor(c); }

    function setBuffer(nb) {
      b = nb; n = nb.length; p = 0;
      dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    }

    // ---- binary readers ----
    function need(k) { if (p + k > n) throw new ParseError('unexpected end of data'); }
    function u8() { need(1); return b[p++]; }
    function i16() { need(2); var v = dv.getInt16(p, true); p += 2; return v; }
    function u16() { need(2); var v = dv.getUint16(p, true); p += 2; return v; }
    function i32() { need(4); var v = dv.getInt32(p, true); p += 4; return v; }
    function count() { var c = u8(); return c ? c : 256 + u16(); }
    function rgba() {
      need(4);
      var c = rev < 33 ? [b[p + 2], b[p + 1], b[p], b[p + 3]] : [b[p], b[p + 1], b[p + 2], b[p + 3]];
      p += 4; return c;
    }
    // relative point readers (update current point, like de_update_current_point)
    function rel32(out) {
      need(8);
      cx = (cx + dv.getInt32(p, true)) | 0; cy = (cy + dv.getInt32(p + 4, true)) | 0; p += 8;
      out.push(cx, cy);
    }
    function rel16(out) {
      need(4);
      cx = (cx + dv.getInt16(p, true)) | 0; cy = (cy + dv.getInt16(p + 2, true)) | 0; p += 4;
      out.push(cx, cy);
    }
    function pts32(k) { need(8 * k); var a = []; for (var i = 0; i < k; i++) rel32(a); return a; }
    function pts16(k) { need(4 * k); var a = []; for (var i = 0; i < k; i++) rel16(a); return a; }

    // ---- ASCII readers ----
    function isWS(c) { return c === 32 || c === 10 || c === 13 || c === 9 || c === 0; }
    function skipWS() { while (p < n && isWS(b[p])) p++; }
    function aInt() {
      skipWS();
      var s = 1, c = b[p];
      if (c === 45) { s = -1; p++; } else if (c === 43) p++;
      skipWS();
      c = b[p];
      if (!(c >= 48 && c <= 57)) throw new ParseError('digit expected');
      var v = 0;
      while (p < n && (c = b[p]) >= 48 && c <= 57) { v = v * 10 + (c - 48); p++; }
      return s * v;
    }
    function aDouble() {
      skipWS();
      var s = 1, c = b[p];
      if (c === 45) { s = -1; p++; } else if (c === 43) p++;
      skipWS();
      var st = p;
      while (p < n) {
        c = b[p];
        if ((c >= 48 && c <= 57) || c === 46 || c === 44) p++;
        else if ((c === 101 || c === 69) && (b[p + 1] === 45 || b[p + 1] === 43 || (b[p + 1] >= 48 && b[p + 1] <= 57))) p += 2;
        else break;
      }
      if (p === st) throw new ParseError('number expected');
      var t = ansiString(b.subarray(st, p)).replace(',', '.');
      var v = parseFloat(t);
      if (isNaN(v)) throw new ParseError('bad number');
      return s * v;
    }
    function expect(ch) {
      if (b[p] !== ch) throw new ParseError("'" + String.fromCharCode(ch) + "' expected");
      p++;
    }
    function aPoint(out) {
      var x = aInt(); skipWS(); expect(44); var y = aInt();
      out.push(x, y);
    }
    function peek() { skipWS(); return p < n ? b[p] : -1; }
    // WT_File::read(char*&): quoted ('...' or "...") or bare word; backslash escapes
    function aToken() {
      skipWS();
      var acc = [], q = 0, c = b[p];
      if (c === 39 || c === 34) {
        q = c; p++;
        for (;;) {
          if (p >= n) throw new ParseError('unterminated string');
          c = b[p++];
          if (c === 92) { acc.push(b[p++]); continue; }
          if (c === q) break;
          acc.push(c);
        }
      } else {
        while (p < n) {
          c = b[p];
          if (isWS(c) || c === 41) break;
          if (c === 92) { p++; acc.push(b[p++]); continue; }
          if ((c === 40 && acc.length) || c === 123) throw new ParseError('bad token');
          acc.push(c); p++;
        }
      }
      return { bytes: acc, quote: q };
    }
    function hexVal(c) { return c <= 57 ? c - 48 : (c | 32) - 87; }
    // WT_String::materialize: {len UTF16LE}, "hex UTF16", 'ansi' or bare word
    function aString() {
      skipWS();
      if (b[p] === 123) {
        p++;
        var len = i32(); need(2 * len + 1);
        var s = '';
        for (var i = 0; i < len; i++) s += String.fromCharCode(b[p + 2 * i] | (b[p + 2 * i + 1] << 8));
        p += 2 * len;
        if (b[p] !== 125) throw new ParseError('} expected after string');
        p++;
        return s;
      }
      var t = aToken();
      if (t.quote === 34) {
        var h = t.bytes, r = '';
        for (var j = 0; j + 3 < h.length; j += 4)
          r += String.fromCharCode((hexVal(h[j]) << 12) | (hexVal(h[j + 1]) << 8) | (hexVal(h[j + 2]) << 4) | hexVal(h[j + 3]));
        return r;
      }
      return ansiString(t.bytes);
    }
    // skip a {count ...} blob inside an ASCII opcode (p just after '{')
    function skipBrace() {
      if (p + 4 > n) { p = n; return; }
      var c = dv.getInt32(p, true);
      if (c > 0 && p + 4 + 2 * c < n && b[p + 4 + 2 * c] === 125) { p += 4 + 2 * c + 1; return; } // binary UTF-16 string
      if (c <= 0) throw new ParseError('bad {} block');
      p += 4 + c;
    }
    // WT_File::skip_past_matching_paren
    function skipToClose(level) {
      var inQ = false;
      while (p < n) {
        var c = b[p++];
        if (c === 92) { p++; continue; }
        if (c === 39) { inQ = !inQ; continue; }
        if (inQ) continue;
        if (c === 40) level++;
        else if (c === 41) { if (--level <= 0) return; }
        else if (c === 123) skipBrace();
      }
    }
    function aOpcodeName() {        // at '(' : returns the token (without the paren)
      p++;
      var st = p;
      while (p < n) {
        var c = b[p];
        if (c >= 33 && c <= 122 && c !== 40 && c !== 41) p++; else break;
      }
      return ansiString(b.subarray(st, p));
    }

    // ---- output helpers ----
    function ext(x, y) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    function extPts(a) { for (var i = 0; i < a.length; i += 2) ext(a[i], a[i + 1]); }
    function add(it) {
      if (layer !== null) it.layer = layer;
      if (clip >= 0) it.clip = clip;
      items.push(it);
    }
    function emitLine(pts) {
      if (!visible || pts.length < 2) return;
      extPts(pts);
      add({ t: 'line', pts: pts, color: colorStr, lw: lw });
    }
    function emitPoly(pts) {
      if (!visible || pts.length < 2) return;
      extPts(pts);
      add({ t: 'poly', pts: pts, color: colorStr, fill: true });
    }
    function emitPolyOrLine(pts) { if (fill) emitPoly(pts); else emitLine(pts); }
    function emitTris(pts, col) {
      if (!visible || pts.length < 6) return;
      extPts(pts);
      add({ t: 'tris', pts: pts, color: col || colorStr });
    }
    function emitContours(cs) {
      if (!visible) return;
      for (var i = 0; i < cs.length; i++) extPts(cs[i]);
      add({ t: 'contours', contours: cs, color: colorStr });
    }
    function emitEllipse(x, y, maj, min, start, end, tilt) {
      // ellipse.cpp: end <= start -> end += 0x10000 (full turn)
      if (rev <= 30) { if (start !== end && end < 0x10000) end++; }
      if (end <= start) end += 0x10000;
      if (!visible) return;
      var r = Math.max(Math.abs(maj), Math.abs(min));
      ext(x - r, y - r); ext(x + r, y + r);
      add({ t: 'ellipse', cx: x, cy: y, rx: maj, ry: min, rot: tilt * ANG, start: start * ANG, end: end * ANG, color: colorStr, lw: lw, fill: fill });
    }
    function emitMarkers(pts) {
      if (!visible) return;
      var s = (macroScale || markerSize) / 2;
      for (var i = 0; i < pts.length; i += 2) {
        var x = pts[i], y = pts[i + 1];
        if (s > 0) {
          emitLine([x - s, y - s, x + s, y + s]);
          emitLine([x - s, y + s, x + s, y - s]);
        } else emitLine([x, y, x, y]);
      }
    }
    function emitText(x, y, str, bounds) {
      if (!visible) return;
      ext(x, y);
      var it = { t: 'text', x: x, y: y, str: str, h: font.height, rot: font.rot * ANG, color: colorStr, font: font.name };
      if (font.oblique) { var o = font.oblique > 32768 ? font.oblique - 65536 : font.oblique; it.oblique = o * ANG; }
      if (font.widthScale !== 1024) it.widthScale = font.widthScale / 1024;
      if (font.spacing !== 1024) it.spacing = font.spacing / 1024;
      if (font.bold) it.bold = true;
      if (font.italic) it.italic = true;
      if (font.underline) it.underline = true;
      if (font.flags) it.flags = font.flags;
      if (halign) it.halign = halign === 1 ? 'center' : 'right';
      if (valign !== 1) it.valign = ['descent', 'baseline', 'half', 'cap', 'ascent'][valign] || 'baseline';
      if (bounds) {
        it.bounds = bounds; extPts(bounds);
        // Some writers (AutoCAD for text inside rotated views) leave the font
        // rotation at 0 and only encode the real orientation in the bounds box
        // (b0 = lower-left, b1 = lower-right).  Trust the box in that case.
        var bx = bounds[2] - bounds[0], by = bounds[3] - bounds[1];
        if (bx * bx + by * by > 0) {
          var ba = Math.atan2(by, bx), fr = it.rot;
          var d = Math.abs(((ba - fr) % TWO_PI + 3 * Math.PI) % TWO_PI - Math.PI);
          if (d > 0.02) { it.fontRot = fr; it.rot = (ba + TWO_PI) % TWO_PI; }
        }
      }
      add(it);
    }
    function emitImage(x0, y0, x1, y1, fmt, cols, rows, data, cm) {
      if (!visible) return;
      var it = null;
      if (fmt === 'PNG') it = { mime: 'image/png', data: data };
      else if (fmt === 'JPEG') it = { mime: 'image/jpeg', data: data };
      else {
        var rgbaData = null;
        try { rgbaData = decodeRaster(fmt, cols, rows, data, cm); }
        catch (e) { if (!(e instanceof ParseError)) throw e; warn('image ' + fmt + ' decode failed: ' + e.message); return; }
        if (rgbaData) it = { w: cols, h: rows, rgba: rgbaData };
        else { warn('unsupported image format ' + fmt); return; }
      }
      it.t = 'image';
      it.x0 = Math.min(x0, x1); it.y0 = Math.min(y0, y1); it.x1 = Math.max(x0, x1); it.y1 = Math.max(y0, y1);
      ext(it.x0, it.y0); ext(it.x1, it.y1);
      // key order: t first
      var o = { t: 'image', x0: it.x0, y0: it.y0, x1: it.x1, y1: it.y1 };
      for (var k in it) if (!(k in o)) o[k] = it[k];
      add(o);
    }
    // raw raster formats (image.cpp).  Rows are stored top row first.
    function decodeRaster(fmt, w, h, d, cm) {
      var px = w * h, out = new Uint8ClampedArray(px * 4), i, j;
      if (fmt === 'RGB') {
        if (d.length < px * 3) return null;
        for (i = 0, j = 0; i < px; i++, j += 3) { out[i * 4] = d[j]; out[i * 4 + 1] = d[j + 1]; out[i * 4 + 2] = d[j + 2]; out[i * 4 + 3] = 255; }
        return out;
      }
      if (fmt === 'RGBA') {
        if (d.length < px * 4) return null;
        out.set(d.subarray(0, px * 4));
        return out;
      }
      if (fmt === 'mapped' || fmt === 'indexed') {
        var map = cm || cmap;
        if (d.length < px) return null;
        for (i = 0; i < px; i++) { var c = map[d[i]] || [0, 0, 0, 0]; out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = c[3]; }
        return out;
      }
      if (fmt === 'group4' || fmt === 'group4x') {
        var bits, pal = cm;
        if ((d[0] === 0x49 && d[1] === 0x49 && d[2] === 42) || (d[0] === 0x4D && d[1] === 0x4D && d[3] === 42)) {
          var tf = readBilevelTiff(d);
          if (tf.w !== w || tf.h !== h) throw new ParseError('TIFF size mismatch');
          bits = tf.bits;
          if (!pal) pal = tf.photometric === 1 ? [[0, 0, 0, 255], [255, 255, 255, 255]] : [[255, 255, 255, 255], [0, 0, 0, 255]];
        } else bits = decodeG4(d, w, h);
        pal = pal || [[255, 255, 255, 255], [0, 0, 0, 255]];
        var c0 = pal[0] || [255, 255, 255, 255], c1 = pal[1] || [0, 0, 0, 255];
        for (i = 0; i < px; i++) { var cc0 = bits[i] ? c1 : c0; out[i * 4] = cc0[0]; out[i * 4 + 1] = cc0[1]; out[i * 4 + 2] = cc0[2]; out[i * 4 + 3] = cc0[3]; }
        return out;
      }
      if (fmt === 'bitonal') {   // 1 bit/pixel, rows padded to bytes
        var stride = (w + 7) >> 3, m2 = cm || [[255, 255, 255, 255], [0, 0, 0, 255]];
        if (d.length < stride * h) return null;
        for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
          var bit = (d[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1, cc = m2[bit] || [0, 0, 0, 255], q = (y * w + x) * 4;
          out[q] = cc[0]; out[q + 1] = cc[1]; out[q + 2] = cc[2]; out[q + 3] = cc[3];
        }
        return out;
      }
      return null;
    }

    // ---- font ----
    function fontBinary() {
      var fields = u16();
      if (fields & 0x0001) font.name = aString();
      if (fields & 0x0002) font.charset = u8();
      if (fields & 0x0004) font.pitch = u8();
      if (fields & 0x0008) font.family = u8();
      if (fields & 0x0010) { var st = u8(); font.bold = !!(st & 1); font.italic = !!(st & 2); font.underline = !!(st & 4); }
      if (fields & 0x0020) font.height = i32();
      if (fields & 0x0040) font.rot = u16();
      if (fields & 0x0080) font.widthScale = u16();
      if (fields & 0x0100) font.spacing = u16();
      if (fields & 0x0200) font.oblique = u16();
      if (fields & 0x0400) font.flags = i32();
    }
    function fontObsolete() {        // rev < 31 (font.cpp)
      var len = count();
      need(len);
      font.name = ansiString(b.subarray(p, p + len)); p += len;
      var bi = u8(); font.bold = !!(bi & 1); font.italic = !!(bi & 2);
      i32(); i32();
    }
    function fontAscii() {
      for (;;) {
        var c = peek();
        if (c === 41) { p++; return; }
        if (c !== 40) throw new ParseError('font option expected');
        var o = aOpcodeName();
        switch (o) {
          case 'Name': font.name = aString(); break;
          case 'Height': font.height = aInt(); break;
          case 'Rotation': font.rot = aInt() & 0xFFFF; break;
          case 'Widthscale': font.widthScale = aInt(); break;
          case 'Spacing': font.spacing = aInt(); break;
          case 'Oblique': font.oblique = aInt() & 0xFFFF; break;
          case 'Flags': font.flags = aInt(); break;
          case 'Style':
            font.bold = font.italic = font.underline = false;
            for (;;) {
              var c2 = peek();
              if (c2 === 41 || c2 < 0) break;
              if (c2 === 40) { p++; skipToClose(1); continue; }
              var w = ansiString(aToken().bytes);
              if (w === 'bold') font.bold = true; else if (w === 'italic') font.italic = true; else if (w === 'underlined') font.underline = true;
            }
            break;
          default: break;                         // Charset/Pitch/Family/unknown
        }
        skipToClose(1);
      }
    }

    // ---- text ----
    function scoring() { var k = count() - 1; for (var i = 0; i < k; i++) count(); }
    function textBinary(complex) {
      var pos = []; rel32(pos);
      var str = aString(), bounds = null;
      if (complex) {
        scoring(); scoring();                 // overscore, underscore
        bounds = pts32(4);                    // bounds (relative)
        if (rev >= 600) scoring();            // reserved
      }
      emitText(pos[0], pos[1], str, bounds);
    }
    function textAscii() {
      var pos = []; aPoint(pos);
      var str = aString(), bounds = null;
      for (;;) {
        var c = peek();
        if (c === 41 || c < 0) { p++; break; }
        if (c !== 40) throw new ParseError('text option expected');
        var o = aOpcodeName();
        if (o === 'Bounds') { bounds = []; for (var i = 0; i < 4; i++) aPoint(bounds); }
        skipToClose(1);
      }
      emitText(pos[0], pos[1], str, bounds);
    }

    // ---- contours ----
    function contourBinary(is16) {
      var nc = count(), counts = [], i, total = 0;
      for (i = 0; i < nc; i++) { counts.push(count()); total += counts[i]; }
      var all = is16 ? pts16(total) : pts32(total);
      return splitContours(all, counts);
    }
    function splitContours(all, counts) {
      var cs = [], o = 0;
      for (var i = 0; i < counts.length; i++) { cs.push(all.slice(o, o + counts[i] * 2)); o += counts[i] * 2; }
      return cs;
    }
    function contourAscii() {
      var nc = aInt(), counts = [], total = 0, i;
      for (i = 0; i < nc; i++) { counts.push(aInt()); total += counts[i]; }
      var all = [];
      for (i = 0; i < total; i++) aPoint(all);
      return splitContours(all, counts);
    }

    // ---- gouraud ----
    function gouraudBinary(is16) {
      var k = count(), pts = [], first = null;
      for (var i = 0; i < k; i++) {
        if (is16) rel16(pts); else rel32(pts);
        var c = rgba(); if (!first) first = c;
      }
      return { pts: pts, color: first ? cssColor(first) : colorStr };
    }
    function aColor() {           // r,g,b,a  or index
      var v = aInt();
      if (b[p] === 44) {
        p++; var g = aInt(); expect(44); var bl = aInt(); expect(44); var a = aInt();
        return [v & 255, g & 255, bl & 255, a & 255];
      }
      return (cmap[v] || [0, 0, 0, 0]).slice();
    }
    function gouraudAscii() {
      var k = aInt(), pts = [], first = null;
      for (var i = 0; i < k; i++) { aPoint(pts); var c = aColor(); if (!first) first = c; }
      return { pts: pts, color: first ? cssColor(first) : colorStr };
    }

    // ---- images ----
    function hexData(len) {
      var d = new Uint8Array(len);
      for (var i = 0; i < len; i++) {
        skipWS(); need(2);
        d[i] = (hexVal(b[p]) << 4) | hexVal(b[p + 1]); p += 2;
      }
      return d;
    }
    function colormapBinary() {
      var k = u8() || 256, m = [];
      for (var i = 0; i < k; i++) m.push(rgba());
      return m;
    }
    function colormapAscii() {
      var k = aInt(), m = [];
      for (var i = 0; i < k; i++) m.push(aColor());
      return m;
    }
    var IMG_ASCII = { 'bitonal': 'bitonal', 'group 3X': 'group3x', 'indexed': 'indexed', 'mapped': 'mapped', 'RGB': 'RGB', 'RGBA': 'RGBA', 'JPEG': 'JPEG' };
    var G4_ASCII = { 'group 4X': 'group4x', 'Group4': 'group4', 'PNG': 'PNG' };
    function imageAscii(g4) {
      var fname = ansiString(aToken().bytes);
      var fmt = g4 ? G4_ASCII[fname] : IMG_ASCII[fname];
      if (!fmt) { warn('unsupported image format ' + fname); skipToClose(1); return; }
      aInt();                                    // identifier
      var cols = aInt(); skipWS(); expect(44); var rows = aInt();
      var c = []; aPoint(c); aPoint(c);
      var cm = null;
      if (g4 && fmt === 'group4x') {
        var cms = aInt();
        if (cms) { if (peek() === 40) { var nm = aOpcodeName(); if (nm === 'ColorMap') { cm = colormapAscii(); skipToClose(1); } else skipToClose(1); } }
      } else if (!g4 && (fmt === 'bitonal' || fmt === 'group3x' || fmt === 'mapped')) {
        if (peek() === 40) { var nm2 = aOpcodeName(); if (nm2 === 'ColorMap') { cm = colormapAscii(); skipToClose(1); } else skipToClose(1); }
      }
      skipWS(); expect(40);
      var len = aInt();
      var data = hexData(len);
      skipToClose(2);
      emitImage(c[0], c[1], c[2], c[3], fmt, cols, rows, data, cm);
    }
    var IMG_BIN = { 2: 'bitonal', 3: 'group3x', 4: 'indexed', 5: 'mapped', 6: 'RGB', 7: 'RGBA', 8: 'JPEG', 9: 'group4', 12: 'PNG', 13: 'group4x' };
    function imageBinary(op) {
      var fmt = IMG_BIN[op];
      var cols = u16(), rows = u16();
      var c = []; rel32(c); rel32(c);
      i32();                                   // identifier
      var cm = null;
      if (op === 2 || op === 3 || op === 5 || op === 13) cm = colormapBinary();
      var len = i32(); need(len);
      var data = b.slice(p, p + len); p += len;
      emitImage(c[0], c[1], c[2], c[3], fmt, cols, rows, data, cm);
    }

    // ---- viewport (clip region) ----
    function viewportAscii() {
      var c = peek();
      if (c === 41) { p++; clip = -1; return; }
      aString();                                // name
      c = peek();
      var cs = null;
      if (c === 40) {
        var save = p, nm = aOpcodeName();
        if (nm === 'Contour') { cs = contourAscii(); skipToClose(1); }
        else { p = save; }
      } else if (c === 0x6B || c === 0x0B) { p++; cs = contourBinary(c === 0x0B); }
      else if (c >= 48 && c <= 57 && rev < 42) { var k = aInt(), a = []; for (var i = 0; i < k; i++) aPoint(a); cs = [a]; }
      skipToClose(1);
      if (cs && cs.length) { clips.push(cs); clip = clips.length - 1; }
      else clip = -1;
    }

    function unitsAscii() {
      var name = aString(), m = [];
      if (peek() === 40) {
        p++;
        for (var r = 0; r < 4; r++) {
          if (peek() !== 40) break;
          p++;
          for (var k = 0; k < 4; k++) m.push(aDouble());
          skipToClose(1);
        }
        skipToClose(1);
      }
      skipToClose(1);
      if (!result.units && m.length === 16) result.units = { name: name, matrix: m };
    }

    // ---- extended ASCII opcode dispatch ----
    function doAscii() {
      var start = p, name = aOpcodeName(), after = p;
      try {
        switch (name) {
          case 'W2D': case 'DWF': {
            skipWS(); if (b[p] === 86) p++;
            var t = ansiString(b.subarray(p, p + 5));
            var mj = parseInt(t.substr(0, 2), 10), mn = parseInt(t.substr(3, 2), 10);
            if (!isNaN(mj) && !isNaN(mn)) {
              rev = mj * 100 + mn;
              if (rev < 38) cmap = palette(PAL_OLD);
            }
            result.version = rev;
            skipToClose(1);
            break;
          }
          case 'EndOfDWF': skipToClose(1); done = true; break;
          case 'Color': setColor(aColor()); skipToClose(1); break;
          case 'ColorMap': cmap = colormapAscii(); skipToClose(1); break;
          case 'Background': result.background = cssColor(aColor()); skipToClose(1); break;
          case 'LineWeight': lw = aInt(); skipToClose(1); break;
          case 'Layer': {
            var num = aInt();
            var c = peek();
            if (c !== 41) { var nm = aString(); if (nm !== '' || !(num in layers)) layers[num] = nm; }
            layer = num;
            skipToClose(1);
            break;
          }
          case 'Font': fontAscii(); break;
          case 'Text': textAscii(); break;
          case 'Contour': { var cs = contourAscii(); skipToClose(1); emitContours(cs); break; }
          case 'Circle': case 'Ellipse': {
            var ce = []; aPoint(ce);
            var maj, min, st = 0, en = 0, tilt = 0;
            if (name === 'Circle') { maj = min = aInt(); }
            else { var mm = []; aPoint(mm); maj = mm[0]; min = mm[1]; }
            if (peek() !== 41) {
              var se = []; aPoint(se); st = se[0] & 0xFFFF; en = se[1] & 0x1FFFF;
              if (name === 'Ellipse' && peek() !== 41) tilt = aInt() & 0xFFFF;
            }
            skipToClose(1);
            emitEllipse(ce[0], ce[1], maj, min, st, en, tilt);
            break;
          }
          case 'Gouraud': { var g = gouraudAscii(); skipToClose(1); emitTris(g.pts, g.color); break; }
          case 'GourLine': {
            var gl = gouraudAscii(); skipToClose(1);
            if (visible) { extPts(gl.pts); add({ t: 'line', pts: gl.pts, color: gl.color, lw: lw }); }
            break;
          }
          case 'Image': imageAscii(false); break;
          case 'Group4PNGImage': imageAscii(true); break;
          case 'Viewport': viewportAscii(); break;
          case 'Units': unitsAscii(); break;
          case 'TextHAlign': {
            var h = ansiString(aToken().bytes);
            halign = h.indexOf('Center') === 0 ? 1 : h.indexOf('Right') === 0 ? 2 : 0;
            skipToClose(1); break;
          }
          case 'TextVAlign': {
            var v = ansiString(aToken().bytes);
            valign = v.indexOf('Ascent') === 0 ? 4 : v.indexOf('Descent') === 0 ? 0 : v.indexOf('Half') === 0 ? 2 : v.indexOf('Cap') === 0 ? 3 : 1;
            skipToClose(1); break;
          }
          case 'Macro':
            warn('macro definitions not supported (skipped)');
            skipToClose(1); break;
          // known non-graphic / rendition opcodes that we deliberately ignore
          case 'Author': case 'Alignment': case 'AttributeURL': case 'BlockMeaning': case 'BlockRef': case 'Comment':
          case 'Comments': case 'ContrastColor': case 'Copyright': case 'Creator': case 'Created': case 'CodePage':
          case 'DashPattern': case 'Description': case 'Directory': case 'Delineate': case 'Embed': case 'Embedded_Font':
          case 'Encryption': case 'FillPattern': case 'FontExtension': case 'GroupBegin': case 'GroupEnd': case 'Guid':
          case 'GuidList': case 'InkedArea': case 'Keywords': case 'LinePattern': case 'LinesOverwrite': case 'LineStyle':
          case 'Modified': case 'NamedView': case 'Node': case 'Orientation': case 'Overpost': case 'PlotInfo':
          case 'PlotOptimized': case 'Psswd': case 'PenPattern': case 'PenPat_Options': case 'Projection':
          case 'SourceCreated': case 'SourceModified': case 'SourceFilename': case 'Subject': case 'SignData':
          case 'TextBackground': case 'Title': case 'TrustedFontList': case 'Time': case 'URL': case 'UserData':
          case 'UserFillPattern': case 'UserHatchPattern': case 'View':
            skipToClose(1); break;
          default:
            warn('unknown ASCII opcode (' + name + ')');
            skipToClose(1);
        }
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        warn('malformed (' + name + '): ' + e.message);
        p = after;
        skipToClose(1);
      }
      if (p === start) p++;       // safety: always make progress
    }

    // ---- extended binary opcode dispatch ----
    function doBinary() {
      var start = p;
      need(7);
      var size = dv.getInt32(p + 1, true), op = dv.getUint16(p + 5, true);
      p += 7;
      if (op === 0x0011 || op === 0x0010 || op === 0x0123) {
        if (compressed) throw new ParseError('nested compression');
        var r = op === 0x0011 ? inflateZlib(b, p, zlibDict()) : inflateWhipLZ(b, p, rev);
        var e = r.end;
        while (e < n && b[e] !== 125 && isWS(b[e])) e++;
        if (b[e] !== 125) warn('missing } after compressed block');
        else e++;
        var rest = b.subarray(e);
        var nb = new Uint8Array(r.out.length + rest.length);
        nb.set(r.out); nb.set(rest, r.out.length);
        setBuffer(nb);
        compressed = true;
        return;
      }
      var next = start + 5 + size;
      if (size < 2 || next > n) throw new ParseError('bad extended binary opcode size');
      try {
        switch (op) {
          case 0x0001: cmap = colormapBinary(); break;
          case 2: case 3: case 4: case 5: case 6: case 7: case 8: case 9: case 12: case 13:
            imageBinary(op); break;
          case 371: { var hv = u8(); halign = hv < 3 ? hv : 0; break; }        // TEXT_HALIGN
          case 373: { var vv = u8(); valign = vv < 5 ? vv : 1; break; }        // TEXT_VALIGN
          case 369: warn('macro definitions not supported (skipped)'); break;
          default:
            if (!((op >= 0x12 && op <= 0x27) || (op >= 318 && op <= 386))) warn('unknown extended binary opcode 0x' + op.toString(16));
        }
      } catch (e2) {
        if (!(e2 instanceof ParseError)) throw e2;
        warn('malformed extended binary opcode 0x' + op.toString(16) + ': ' + e2.message);
      }
      p = next;
    }

    // ---- header ----
    var head = ansiString(b.subarray(0, 12));
    if (/^\((DWF|W2D) V\d\d\.\d\d\)/.test(head)) {
      rev = parseInt(head.substr(6, 2), 10) * 100 + parseInt(head.substr(9, 2), 10);
      if (rev < 38) cmap = palette(PAL_OLD);
      result.version = rev;
      p = 12;
    } else if (head.indexOf('(DWF V') === 0 || head.indexOf('(W2D V') === 0) {
      // let the generic opcode reader deal with it
    } else {
      warn('stream does not start with (W2D V or (DWF V');
    }

    // ---- main loop ----
    var unknownSingle = 0;
    while (!done && p < n) {
      var c = b[p];
      if (c === 32 || c === 10 || c === 13 || c === 9 || c === 0) { p++; continue; }
      if (c === 40) { doAscii(); continue; }
      if (c === 123) {
        try { doBinary(); } catch (eb) {
          if (!(eb instanceof ParseError) && !(eb instanceof Error)) throw eb;
          warn('extended binary opcode error: ' + eb.message);
          result.aborted = true; break;
        }
        continue;
      }
      if (c === 41) { p++; warn('stray )'); continue; }
      var opStart = p;
      p++;
      try {
        switch (c) {
          // ---- attributes ----
          case 0x03: setColor(rgba()); break;                                  // Ctrl-C  RGBA color
          case 0x43: { var ci = aInt(); setColor((cmap[ci] || [0, 0, 0, 0]).slice()); break; }  // 'C'
          case 0x63: { var cb = u8(); setColor((cmap[cb] || [0, 0, 0, 0]).slice()); break; }    // 'c'
          case 0x06: if (rev < 31) fontObsolete(); else fontBinary(); break;    // Ctrl-F
          case 0x46: fill = true; break;                                       // 'F'
          case 0x66: fill = false; break;                                      // 'f'
          case 0x56: visible = true; break;                                    // 'V'
          case 0x76: visible = false; break;                                   // 'v'
          case 0x17: lw = i32(); break;                                        // Ctrl-W
          case 0xAC: layer = count(); break;                                   // layer
          case 0xCC: count(); break;                                           // line pattern
          case 0x4F: { need(8); cx = dv.getInt32(p, true); cy = dv.getInt32(p + 4, true); p += 8; break; } // 'O' origin
          case 0x4E: i32(); break;                                             // 'N' object node 32
          case 0x6E: i16(); break;                                             // 'n' object node 16
          case 0x0E: break;                                                    // object node auto
          case 0x47: if (rev < 601) markerSymbol = aInt(); else macroIndex = aInt(); break; // 'G'
          case 0x53: if (rev < 601) markerSize = aInt(); else macroScale = aInt(); break;   // 'S'
          case 0x73: if (rev < 601) markerSize = i32(); else macroScale = i32(); break;     // 's'
          // ---- lines / polylines / polygons ----
          case 0x0C: emitLine(pts16(2)); break;                                // Ctrl-L
          case 0x6C: emitLine(pts32(2)); break;                                // 'l'
          case 0x4C: { var lp = []; aPoint(lp); aPoint(lp); emitLine(lp); break; } // 'L'
          case 0x10: emitPolyOrLine(pts16(count())); break;                    // Ctrl-P
          case 0x70: emitPolyOrLine(pts32(count())); break;                    // 'p'
          case 0x50: { var pk = aInt(), pp = []; for (var i = 0; i < pk; i++) aPoint(pp); emitPolyOrLine(pp); break; } // 'P'
          // ---- triangles / contours ----
          case 0x14: emitTris(pts16(count())); break;                          // Ctrl-T
          case 0x74: emitTris(pts32(count())); break;                          // 't'
          case 0x54: { var tk = aInt(), tp = []; for (var j = 0; j < tk; j++) aPoint(tp); emitTris(tp); break; } // 'T'
          case 0x0B: emitContours(contourBinary(true)); break;                 // Ctrl-K
          case 0x6B: emitContours(contourBinary(false)); break;                // 'k'
          case 0x07: { var g16 = gouraudBinary(true); emitTris(g16.pts, g16.color); break; }   // Ctrl-G
          case 0x67: { var g32 = gouraudBinary(false); emitTris(g32.pts, g32.color); break; }  // 'g'
          case 0x11: case 0x71: {                                              // Ctrl-Q / 'q' gouraud polyline
            var gq = gouraudBinary(c === 0x11);
            if (visible) { extPts(gq.pts); add({ t: 'line', pts: gq.pts, color: gq.color, lw: lw }); }
            break;
          }
          // ---- markers / macro draw ----
          case 0x8D: emitMarkers(pts16(count())); break;
          case 0x6D: emitMarkers(pts32(count())); break;
          case 0x4D: { var mk = aInt(), mp = []; for (var q = 0; q < mk; q++) aPoint(mp); emitMarkers(mp); break; }
          // ---- circles / ellipses / arcs ----
          case 0x12: { var c16 = pts16(1); var r16 = u16(); emitEllipse(c16[0], c16[1], r16, r16, 0, 0x10000, 0); break; } // Ctrl-R
          case 0x72: { var c32 = pts32(1); var r32 = i32(); emitEllipse(c32[0], c32[1], r32, r32, 0, 0x10000, 0); break; } // 'r'
          case 0x52: { var ca = []; aPoint(ca); var ra = aInt(); emitEllipse(ca[0], ca[1], ra, ra, 0, 0, 0); break; }   // 'R'
          case 0x92: { var cc = pts32(1); var rr = i32(), s0 = u16(), e0 = u16(); emitEllipse(cc[0], cc[1], rr, rr, s0, e0, 0); break; } // arc
          case 0x65: { var ce = pts32(1); var ma = i32(), mi = i32(), s1 = u16(), e1 = u16(), ti = u16(); emitEllipse(ce[0], ce[1], ma, mi, s1, e1, ti); break; } // 'e'
          case 0x45: { var ea = []; aPoint(ea); var eb2 = []; aPoint(eb2); emitEllipse(ea[0], ea[1], eb2[0], eb2[1], 0, 0, 0); break; } // 'E'
          // ---- text ----
          case 0x18: if (rev < 32) throw new ParseError('obsolete text form'); textBinary(true); break;   // Ctrl-X
          case 0x78: if (rev < 32) throw new ParseError('obsolete text form'); textBinary(false); break;  // 'x'
          // ---- bezier: the reference toolkit has no reader for these (WT_Unknown) ----
          case 0x02: case 0x42: case 0x62:
            throw new ParseError('Bezier opcode 0x' + c.toString(16) + ' has no defined operand format');
          default:
            throw new ParseError('unknown single-byte opcode 0x' + c.toString(16));
        }
      } catch (es) {
        if (!(es instanceof ParseError)) throw es;
        warn(es.message);
        unknownSingle++;
        if (unknownSingle > 50) { warn('too many errors, parsing aborted'); result.aborted = true; break; }
        p = opStart + 1;
      }
    }
    if (!done) warn('EndOfDWF not reached');
    result.complete = done;

    for (var wi = 0; wi < warnOrder.length; wi++) {
      var k = warnOrder[wi];
      result.warnings.push(warnCounts[k] > 1 ? k + ' (x' + warnCounts[k] + ')' : k);
    }
    result.bounds = minX <= maxX ? { minX: minX, minY: minY, maxX: maxX, maxY: maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    if (clips.length) result.clips = clips;
    return result;
  }

  function parse(u8) {
    return new Promise(function (resolve, reject) {
      try {
        if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8);
        resolve(parseSync(u8));
      } catch (e) { reject(e); }
    });
  }

  return { parse: parse, parseSync: parseSync };
})();

if (typeof module !== 'undefined') module.exports = W2D; else self.W2D = W2D;
