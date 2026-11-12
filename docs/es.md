# Meshtastic

Lleva su red mallada LoRa [Meshtastic](https://meshtastic.org) a Gladys: un dispositivo por nodo (en línea, oído por
última vez, señal, saltos, batería, tensión, distancia a casa, temperatura, humedad, presión), un disparador de escena con
cada mensaje de texto recibido y una acción de escena para enviar uno.

> Desarrollada sin hardware LoRa: probada con el firmware oficial `meshtasticd` en modo de radio simulada, por TCP y por
> MQTT. Sus comentarios son bienvenidos en el foro de Gladys.

## Lo que obtiene

- **Dispositivos**: cada nodo que conoce su nodo se ofrece en la pestaña Descubrimiento, con su nombre en la malla
  (nombre largo, identificador `!xxxxxxxx`). Añada los que le interesen. Cada uno recibe:
  - **En línea** (oído dentro del plazo elegido) y **Oído por última vez** (fecha y hora);
  - **Señal (recepción directa)**: de 0 a 5, según el SNR del último paquete oído en directo (sin repetidor);
  - **Saltos**: cuántos repetidores atravesó el último paquete;
  - **Batería** y **Tensión de la batería**, cuando el nodo las envía (un nodo conectado a la red muestra 100 %);
  - **Distancia a casa** en km, cuando el nodo comparte su posición y su casa de Gladys está localizada;
  - **Temperatura**, **Humedad**, **Presión**, cuando el nodo tiene un sensor ambiental.
- **Disparador de escena «Mensaje recibido»**: llegó un mensaje de texto a un canal, o en directo a su nodo. Filtre por
  canal (o «Mensaje directo») y por nodo remitente; el texto, el nombre del remitente, su identificador y el canal están
  disponibles como variables para las acciones siguientes (reenviarlo por Telegram, leerlo en voz alta…).
- **Acción de escena «Enviar un mensaje»**: envía un texto a un canal, o directamente a un nodo. Cortado a 200 bytes, el
  límite de la radio.
- **Widget «Malla Meshtastic»**: sus nodos con batería y última escucha, el último mensaje recibido y un botón **Enviar un
  mensaje**.
- Botón **Comprobar la conexión** en la página de la integración.

La integración nunca modifica la configuración de su radio.

## Requisitos

- Gladys Assistant 5.2.0 o posterior.
- O bien un nodo accesible en la red, por **TCP en el puerto 4403**: una placa ESP32 en Wi-Fi o Ethernet con la API de
  red activada, o un equipo Linux con `meshtasticd`;
- o bien un broker MQTT local donde publica el **módulo MQTT** de un nodo, con la **salida JSON activada**
  (`mqtt.json_enabled`). El JSON no existe en las placas nRF52 (RAK4631, T-Echo…): use TCP con otro nodo, o un nodo ESP32
  como pasarela.
- El puerto serie USB no es compatible: la integración funciona en un contenedor, sin acceso a los puertos USB.

## Instalación

1. En Gladys, abra **Integraciones → Instalar desde GitHub** e introduzca `https://github.com/guim31/gladys-meshtastic`.
2. Abra la integración, elija la conexión, rellene sus campos y guarde.
3. Pulse **Comprobar la conexión**, luego abra la pestaña **Descubrimiento** y añada sus nodos.

Gladys pide la ubicación de su casa al instalar: solo sirve para la distancia y nunca sale de su Gladys.

## Configuración

| Campo                    | Uso                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Conexión                 | **TCP hacia un nodo** (recomendado: lista completa de nodos, nombres de canales, mensajes directos) o **Broker MQTT (JSON)**.                 |
| Dirección del nodo (TCP) | Dirección IP o nombre de host del nodo, p. ej. `192.0.2.40`. Puerto `4403` salvo cambio.                                                      |
| Dirección del broker     | `mqtt://host:1883` o `mqtts://host:8883`, con usuario y contraseña si los hay.                                                                |
| Tema raíz                | El tema raíz del módulo MQTT del nodo, `msh` por defecto. El firmware añade la región (`msh/EU_868/2/json/…`).                                |
| Nodo de envío (MQTT)     | Identificador (`!a1b2c3d4`) del nodo que envía sus mensajes por MQTT. Vacío: el último nodo oído.                                             |
| Fuera de línea tras      | Un nodo no oído durante este tiempo aparece fuera de línea (2 horas por defecto; los nodos envían su telemetría cada 30 minutos por defecto). |
| Idioma de los textos     | Idioma de los nombres de funciones y de los mensajes de la integración.                                                                       |

### TCP

En el nodo, active el Wi-Fi o el Ethernet en los ajustes de red (la API de red escucha en el puerto 4403). **Un nodo solo
acepta un cliente TCP a la vez**: mientras Gladys está conectado, la app Meshtastic no puede conectarse al mismo nodo por
Wi-Fi (el Bluetooth sigue funcionando). La integración se reconecta sola cada 15 segundos tras un corte.

### MQTT

En el nodo pasarela: módulo MQTT activado, dirección de **su broker local**, **salida JSON activada** y **uplink**
activado en los canales a seguir. La integración se suscribe a `<raíz>/#` y lee los temas `…/2/json/…`; los paquetes
cifrados se ignoran. No la conecte al broker público `mqtt.meshtastic.org`: transporta el mundo entero.

Para **enviar** por MQTT, la pasarela necesita un canal llamado `mqtt` con el **downlink** activado (su clave da igual) y
luego un reinicio; así acepta el firmware mensajes JSON para enviar. Indique su identificador en **Nodo de envío** si
varios nodos publican en el broker.

## Dispositivos y funciones

Una función solo aparece si el nodo la ha enviado cuando lo añade (batería, posición, sensor ambiental). Si aparece más
tarde, Gladys muestra **Actualizar** junto al nodo en la pestaña Descubrimiento.

- La **señal** es la del último paquete oído **en directo** por su nodo: un nodo siempre oído a través de repetidores no
  tiene valor. Escala: 5 con un SNR de 5 dB o más, 4 desde 0 dB, 3 desde -5 dB, 2 desde -10 dB, 1 por debajo.
- **Saltos** cuenta los repetidores del último paquete (0: oído en directo).
- El nodo al que está conectado por TCP está siempre en línea mientras dure la conexión.
- Tras un reinicio, un nodo aún no oído solo aparece fuera de línea una vez pasado el plazo.

## Escenas

### Mensaje recibido

Se dispara una vez por mensaje, aunque se oiga varias veces (repetidores, varias pasarelas MQTT). Filtros:

- **Canal**: un número de canal (0 es el canal principal), o **Mensaje directo**;
- **Nodo remitente**: uno de sus dispositivos nodo.

Variables: **Texto del mensaje**, **Nombre del remitente** (su nombre en Gladys si lo añadió, si no el de la malla),
**Identificador del nodo remitente**, **Canal** (`0`…`7` o `direct`). Los mensajes enviados desde Gladys no lo disparan.

### Enviar un mensaje

Campos: el **mensaje**, el **canal** (número en su nodo) y, opcionalmente, un **nodo** para un mensaje directo. Salidas:
**Enviado**, **Cortado a 200 bytes**, **Frase** (p. ej. «Mensaje enviado al canal 0.»). La acción falla, con un mensaje
claro, cuando el texto está vacío o la malla no está conectada.

## Widget

**Malla Meshtastic** muestra los nodos que añadió (en línea primero, con la batería y desde cuándo no se oyen), el último
mensaje recibido y un botón **Enviar un mensaje** que abre un pequeño formulario (texto y canal). Cada bloque se oculta en
los ajustes del widget: **Mostrar el último mensaje**, **Mostrar el botón de envío**, **Ocultar los nodos fuera de
línea**.

## Límites

- Desarrollada y probada sin hardware LoRa, con `meshtasticd` en radio simulada: sus comentarios son bienvenidos.
- Sin puerto serie USB ni Bluetooth: solo TCP o MQTT.
- Por MQTT solo se ve lo que una pasarela publica en JSON; sin nombres de canales, y un mensaje directo solo sale si la
  pasarela alcanza el nodo.
- Puntos de ruta, traceroutes, vecinos y otros módulos no se muestran.
- Un texto está limitado a 200 bytes (unas 200 letras sin tilde, menos con tildes o emoji).

## Privacidad y red

Todo se queda en su red local: la integración solo habla con su nodo o con su broker. Los mensajes recibidos se guardan
en memoria (los 20 últimos, para el widget) y nunca se escriben en disco. El identificador de cliente MQTT se guarda en
`/data`. La contraseña del broker nunca aparece en los registros.

## Solución de problemas

- **«El nodo Meshtastic no responde por TCP»**: compruebe la dirección, que el Wi-Fi o el Ethernet estén activados y que
  la app Meshtastic no esté conectada al nodo por Wi-Fi al mismo tiempo.
- **Conectado por MQTT pero sin nodos**: compruebe el tema raíz y que la salida JSON esté activada (`mqtt.json_enabled`).
- **«Ninguna pasarela oída por MQTT»**: la integración aprende el tema de envío del tráfico; espere un primer paquete.
- **Un mensaje no sale por MQTT**: la pasarela necesita un canal llamado `mqtt` con el downlink activado y luego un
  reinicio.
- Registros detallados: inicie la integración con `LOG_LEVEL=debug`.

## Créditos

Meshtastic® es una marca registrada de Meshtastic LLC. Esta integración no está afiliada a Meshtastic LLC ni respaldada
por ella. Lee la API de cliente pública (números de campo protobuf de
[meshtastic/protobufs](https://github.com/meshtastic/protobufs)) y el formato JSON del firmware, sin reutilizar su
código.
