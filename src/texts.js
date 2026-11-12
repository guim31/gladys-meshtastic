// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of Gladys. German
// says "du", Spanish "usted". The language is the one of the configuration
// (a device integration and a scene action do not receive the user's), except
// for the widget, which gets the viewer's.
// -----------------------------------------------------------------------------

export const pick = (table, language) => table[language] ?? table.en;

/** Feature names, frozen when the user adds the device. */
export const FEATURE_NAMES = {
  en: {
    online: 'Online',
    last_heard: 'Last heard',
    signal: 'Signal (direct reception)',
    hops: 'Hops away',
    battery: 'Battery',
    voltage: 'Battery voltage',
    distance: 'Distance from home',
    temperature: 'Temperature',
    humidity: 'Humidity',
    pressure: 'Pressure',
  },
  fr: {
    online: 'En ligne',
    last_heard: 'Entendu pour la dernière fois',
    signal: 'Signal (réception directe)',
    hops: 'Sauts',
    battery: 'Batterie',
    voltage: 'Tension de la batterie',
    distance: 'Distance de la maison',
    temperature: 'Température',
    humidity: 'Humidité',
    pressure: 'Pression',
  },
  de: {
    online: 'Online',
    last_heard: 'Zuletzt gehört',
    signal: 'Signal (direkter Empfang)',
    hops: 'Hops entfernt',
    battery: 'Akku',
    voltage: 'Akkuspannung',
    distance: 'Entfernung von zu Hause',
    temperature: 'Temperatur',
    humidity: 'Luftfeuchtigkeit',
    pressure: 'Luftdruck',
  },
  es: {
    online: 'En línea',
    last_heard: 'Oído por última vez',
    signal: 'Señal (recepción directa)',
    hops: 'Saltos',
    battery: 'Batería',
    voltage: 'Tensión de la batería',
    distance: 'Distancia a casa',
    temperature: 'Temperatura',
    humidity: 'Humedad',
    pressure: 'Presión',
  },
};

/** Connection status of the integration page. */
export const MESSAGES = {
  notConfigured: {
    en: 'Enter the address of a Meshtastic node (TCP) or of the MQTT broker.',
    fr: "Saisissez l'adresse d'un nœud Meshtastic (TCP) ou du broker MQTT.",
    de: 'Gib die Adresse eines Meshtastic-Knotens (TCP) oder des MQTT-Brokers ein.',
    es: 'Introduzca la dirección de un nodo Meshtastic (TCP) o del broker MQTT.',
  },
  nodeUnreachable: {
    en: 'The Meshtastic node does not answer on TCP. Check its address, its network API and that no other app holds it.',
    fr: "Le nœud Meshtastic ne répond pas en TCP. Vérifiez son adresse, son API réseau et qu'aucune autre appli ne l'occupe.",
    de: 'Der Meshtastic-Knoten antwortet nicht über TCP. Prüfe seine Adresse, seine Netzwerk-API und dass keine andere App ihn belegt.',
    es: 'El nodo Meshtastic no responde por TCP. Compruebe su dirección, su API de red y que ninguna otra app lo ocupe.',
  },
  unreachable: {
    en: 'The MQTT broker does not answer. Check its address and that it accepts this network.',
    fr: "Le broker MQTT ne répond pas. Vérifiez son adresse et qu'il accepte ce réseau.",
    de: 'Der MQTT-Broker antwortet nicht. Prüfe seine Adresse und ob er dieses Netz zulässt.',
    es: 'El broker MQTT no responde. Compruebe su dirección y que acepte esta red.',
  },
  refused: {
    en: 'The MQTT broker refuses the user name or the password.',
    fr: "Le broker MQTT refuse le nom d'utilisateur ou le mot de passe.",
    de: 'Der MQTT-Broker lehnt den Benutzernamen oder das Passwort ab.',
    es: 'El broker MQTT rechaza el nombre de usuario o la contraseña.',
  },
  publishFailed: {
    en: 'The integration could not start. Restart it from its page.',
    fr: "L'intégration n'a pas pu démarrer. Redémarrez-la depuis sa page.",
    de: 'Die Integration konnte nicht starten. Starte sie auf ihrer Seite neu.',
    es: 'La integración no pudo arrancar. Reiníciela desde su página.',
  },
};

/** The check_connection action. */
export const CHECK_TEXT = {
  en: {
    notConfigured: MESSAGES.notConfigured.en,
    nodeUnreachable: MESSAGES.nodeUnreachable.en,
    unreachable: MESSAGES.unreachable.en,
    refused: MESSAGES.refused.en,
    connecting: 'Connecting, try again in a few seconds.',
    noNode: (address) =>
      `Connected to ${address}, but no Meshtastic packet heard yet: check the root topic and that JSON output is on.`,
    ok: (address, nodes, online) =>
      `Connected to ${address}: ${nodes} node(s) known, ${online} online.`,
  },
  fr: {
    notConfigured: MESSAGES.notConfigured.fr,
    nodeUnreachable: MESSAGES.nodeUnreachable.fr,
    unreachable: MESSAGES.unreachable.fr,
    refused: MESSAGES.refused.fr,
    connecting: 'Connexion en cours, réessayez dans quelques secondes.',
    noNode: (address) =>
      `Connecté à ${address}, mais aucun paquet Meshtastic entendu : vérifiez le sujet racine et que la sortie JSON est activée.`,
    ok: (address, nodes, online) =>
      `Connecté à ${address} : ${nodes} nœud(s) connu(s), ${online} en ligne.`,
  },
  de: {
    notConfigured: MESSAGES.notConfigured.de,
    nodeUnreachable: MESSAGES.nodeUnreachable.de,
    unreachable: MESSAGES.unreachable.de,
    refused: MESSAGES.refused.de,
    connecting: 'Verbindung läuft, versuch es in ein paar Sekunden erneut.',
    noNode: (address) =>
      `Mit ${address} verbunden, aber noch kein Meshtastic-Paket gehört: Prüfe das Root-Topic und ob die JSON-Ausgabe aktiv ist.`,
    ok: (address, nodes, online) =>
      `Mit ${address} verbunden: ${nodes} Knoten bekannt, ${online} online.`,
  },
  es: {
    notConfigured: MESSAGES.notConfigured.es,
    nodeUnreachable: MESSAGES.nodeUnreachable.es,
    unreachable: MESSAGES.unreachable.es,
    refused: MESSAGES.refused.es,
    connecting: 'Conectando, inténtelo de nuevo en unos segundos.',
    noNode: (address) =>
      `Conectado a ${address}, pero ningún paquete Meshtastic oído: compruebe el tema raíz y que la salida JSON esté activada.`,
    ok: (address, nodes, online) =>
      `Conectado a ${address}: ${nodes} nodo(s) conocido(s), ${online} en línea.`,
  },
};

/** The send_message scene action: errors (thrown) and summary. */
export const SEND_TEXT = {
  en: {
    empty: 'The message is empty.',
    notConnected: 'Not connected to the mesh: the message was not sent.',
    noGateway:
      'No gateway heard on MQTT yet: the message cannot be sent until a node publishes JSON.',
    unknownNode: 'This device is not a Meshtastic node of the integration.',
    sentChannel: (index) => `Message sent to channel ${index}.`,
    sentNode: (name) => `Message sent to ${name}.`,
  },
  fr: {
    empty: 'Le message est vide.',
    notConnected: "Pas de connexion au maillage : le message n'est pas parti.",
    noGateway:
      "Aucune passerelle entendue en MQTT : le message ne peut partir qu'après une publication JSON d'un nœud.",
    unknownNode: "Cet appareil n'est pas un nœud Meshtastic de l'intégration.",
    sentChannel: (index) => `Message envoyé sur le canal ${index}.`,
    sentNode: (name) => `Message envoyé à ${name}.`,
  },
  de: {
    empty: 'Die Nachricht ist leer.',
    notConnected: 'Keine Verbindung zum Mesh: Die Nachricht wurde nicht gesendet.',
    noGateway:
      'Noch kein Gateway über MQTT gehört: Die Nachricht kann erst gesendet werden, wenn ein Knoten JSON veröffentlicht.',
    unknownNode: 'Dieses Gerät ist kein Meshtastic-Knoten der Integration.',
    sentChannel: (index) => `Nachricht auf Kanal ${index} gesendet.`,
    sentNode: (name) => `Nachricht an ${name} gesendet.`,
  },
  es: {
    empty: 'El mensaje está vacío.',
    notConnected: 'Sin conexión con la malla: el mensaje no se envió.',
    noGateway:
      'Ninguna pasarela oída por MQTT: el mensaje solo podrá enviarse cuando un nodo publique JSON.',
    unknownNode: 'Este dispositivo no es un nodo Meshtastic de la integración.',
    sentChannel: (index) => `Mensaje enviado al canal ${index}.`,
    sentNode: (name) => `Mensaje enviado a ${name}.`,
  },
};

/** Date and time of a "last heard", in the Gladys time zone (TZ). */
export function formatHeard(ms, language, timeZone = process.env.TZ) {
  const options = {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  };
  try {
    return new Intl.DateTimeFormat(language, options).format(new Date(ms));
  } catch {
    // An unknown TZ name: the container's own zone.
    return new Intl.DateTimeFormat(language, { ...options, timeZone: undefined }).format(
      new Date(ms),
    );
  }
}

/** "5 min", "2 h", "3 d": how long ago, for the widget. */
export const AGO = {
  en: {
    now: 'now',
    minutes: (n) => `${n} min ago`,
    hours: (n) => `${n} h ago`,
    days: (n) => `${n} d ago`,
  },
  fr: {
    now: "à l'instant",
    minutes: (n) => `il y a ${n} min`,
    hours: (n) => `il y a ${n} h`,
    days: (n) => `il y a ${n} j`,
  },
  de: {
    now: 'gerade eben',
    minutes: (n) => `vor ${n} Min.`,
    hours: (n) => `vor ${n} Std.`,
    days: (n) => `vor ${n} T.`,
  },
  es: {
    now: 'ahora',
    minutes: (n) => `hace ${n} min`,
    hours: (n) => `hace ${n} h`,
    days: (n) => `hace ${n} d`,
  },
};

export function formatAgo(ms, language) {
  const text = pick(AGO, language);
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) {
    return text.now;
  }
  if (minutes < 60) {
    return text.minutes(minutes);
  }
  if (minutes < 48 * 60) {
    return text.hours(Math.floor(minutes / 60));
  }
  return text.days(Math.floor(minutes / 1440));
}
