const AIRLINES: Record<string, string> = {
  alaska: "alaskaair.com",
  united: "united.com",
  delta: "delta.com",
  american: "aa.com",
  southwest: "southwest.com",
  jetblue: "jetblue.com",
  frontier: "flyfrontier.com",
  spirit: "spirit.com",
  hawaiian: "hawaiianairlines.com",
  "sun country": "suncountry.com",
  breeze: "flybreeze.com",
  allegiant: "allegiantair.com",
  "air canada": "aircanada.com",
  westjet: "westjet.com",
  "air india": "airindia.com",
  indigo: "goindigo.in",
  vistara: "airvistara.com",
  emirates: "emirates.com",
  qatar: "qatarairways.com",
  etihad: "etihad.com",
  lufthansa: "lufthansa.com",
  "british airways": "britishairways.com",
  "air france": "airfrance.com",
  klm: "klm.com",
  "virgin atlantic": "virginatlantic.com",
  "singapore airlines": "singaporeair.com",
  "cathay pacific": "cathaypacific.com",
  ana: "ana.co.jp",
  jal: "jal.co.jp",
  "japan airlines": "jal.co.jp",
  "korean air": "koreanair.com",
  "turkish airlines": "turkishairlines.com",
  aeromexico: "aeromexico.com",
  volaris: "volaris.com",
  iberia: "iberia.com",
  tap: "flytap.com",
  "tap air portugal": "flytap.com",
  swiss: "swiss.com",
  qantas: "qantas.com",
  "air new zealand": "airnewzealand.com",
};

export function airlineHost(name: string): string | undefined {
  const first = name
    .split(/[,·]|\band\b/)[0]
    .trim()
    .toLowerCase()
    .replace(/\s+(airlines?|airways)$/, "");
  return AIRLINES[first] ?? AIRLINES[name.trim().toLowerCase()];
}
