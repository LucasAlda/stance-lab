# Stance Lab

Prototipo local para usar una Wii Balance Board como plataforma de carga vertical durante ejercicios de golf. Adquisición en Python, servicio en TypeScript y dashboard con **TanStack Start + React**. Funciona sin nube: la Raspberry Pi conecta la tabla por Bluetooth y sirve la web a los equipos de tu red.

## Probar sin hardware

Requisitos: Node **22.12+** (recomendado Node 24 LTS), npm y Python 3.10+ para el puente real y las pruebas Python. Desarrollo y build verificados con Node 24 en macOS.

```sh
npm ci
npm run dev
```

Abrí **http://localhost:3000**. El simulador es la fuente predeterminada y está identificado en toda la interfaz. Produce un ciclo sintético de 8 segundos, a aproximadamente 100 reportes/s según la planificación del sistema. No representa datos reales ni garantiza el muestreo de una Wii.

- Grabar / detener: conserva todas las muestras adquiridas, hasta 60 s o 12.000 muestras por captura.
- Sesiones: reproducción temporal, pausa, cursor y descarga CSV.
- Dispositivo: tara, referencia corporal y geometría de sensores.
- Gráficos: fuerza vertical en %BW y CoP en X/Y; la interfaz recibe lotes a 30 Hz.
- Sin señal: deja de presentar la última lectura como actual luego de 500 ms sin muestras.

## Raspberry Pi / Linux

Usá Raspberry Pi OS de 64 bits con Bluetooth Classic disponible, Node compatible y Python 3.10+. El emparejamiento y la calidad de lectura **requieren validación física con tu tabla**; no se han probado en hardware en este entorno.

### 1. Preparar Python y Bluetooth

```sh
sudo apt update
sudo apt install bluez python3-venv
sudo systemctl enable --now bluetooth
python3 -m venv .venv
.venv/bin/python -m pip install -r python/requirements.txt
npm ci
```

El Node provisto por algunas versiones de Raspberry Pi OS puede ser demasiado viejo. Verificá `node --version` antes de instalar dependencias.

### 2. Emparejar

```sh
bluetoothctl
```

Dentro de `bluetoothctl`:

```text
power on
scan on
```

Presioná el botón rojo **SYNC**, dentro del compartimento de pilas. Buscá `Nintendo RVL-WBC-01`, anotá su MAC y ejecutá, reemplazando la dirección:

```text
scan off
pair AA:BB:CC:DD:EE:FF
trust AA:BB:CC:DD:EE:FF
quit
```

BlueZ incluye soporte especial para el emparejamiento Wii. Si pide un PIN convencional o rechaza la conexión, revisá que el plugin autopair esté habilitado y que el adaptador soporte Bluetooth Classic. No supongas que el PIN es `0000`.

### 3. Iniciar adquisición

```sh
SOURCE=wii WII_ADDRESS=AA:BB:CC:DD:EE:FF npm run dev
```

Volvé a presionar SYNC cuando espere la conexión. Sin `WII_ADDRESS`, el puente busca una tabla emparejada por nombre mediante `bluetoothctl devices`.

El puente usa `wiibalance==1.4.1` **en modo directo** y es dueño de los sockets L2CAP. No ejecutes el daemon de wiibalance, Dolphin ni otro lector de la misma tabla al mismo tiempo. No se configura reconexión permanente por daemon: el servicio reintenta cada 2 s, pero la tabla puede necesitar otra pulsación de SYNC después de apagarse o desconectarse.

Para revisar el puente aisladamente:

```sh
WII_ADDRESS=AA:BB:CC:DD:EE:FF .venv/bin/python -u python/bridge.py
```

Stdout contiene un JSON por reporte recibido; los diagnósticos van a stderr. Cada muestra incluye reloj monotónico del host, ID de conexión, cuatro cuentas originales, cuatro cargas calibradas y descartes de la cola. La cola está acotada a 512 muestras. No se eliminan muestras porque sus valores de fuerza coincidan: una lectura estable sigue siendo una muestra nueva.

El adaptador extiende un método privado del parser de wiibalance para recibir reportes sin polling. Por eso la versión está fijada; antes de actualizarla hay que verificar ese contrato. Los valores kg se recalculan desde las cuentas y la calibración de fábrica, independientemente de la preferencia métrica/imperial del usuario. No aplica compensación térmica adicional; comprobar tara y deriva forma parte de la validación.

## Producción local y acceso desde Mac / teléfono

```sh
npm run build
SOURCE=wii WII_ADDRESS=AA:BB:CC:DD:EE:FF npm start
```

El servidor de producción integra assets, SSR de TanStack Start, API y WebSocket en **un puerto: 3000**. Abrí `http://IP-DE-LA-PI:3000` desde otro equipo de la misma LAN. El Bluetooth queda en la Pi; el Mac o teléfono solo necesita navegador. En desarrollo, Vite escucha en 3000 y hace proxy al servicio de adquisición en 8787, ligado a loopback.

La aplicación está pensada para una LAN de confianza y no incluye autenticación. No publiques el puerto en Internet. Los datos se guardan únicamente en el directorio local configurado.

### Arranque con systemd

Copiá y editá `deploy/stance-lab.service`: ajustá usuario, directorios y la ruta absoluta de Node (`command -v node`). Si usás nvm, el servicio no carga tu shell interactiva. Creá `.env` en el directorio del proyecto con la MAC y los valores necesarios; systemd lo carga mediante `EnvironmentFile`. Los comandos npm no cargan `.env` automáticamente.

```sh
sudo cp deploy/stance-lab.service /etc/systemd/system/stance-lab.service
sudo systemctl daemon-reload
sudo systemctl enable --now stance-lab
journalctl -u stance-lab -f
```

El cierre normal guarda una grabación activa con muestras. Ante pérdida de energía no se garantiza recuperar una captura que aún no se haya detenido.

## Adquisición desde Mac con The Balance Toolkit

El dashboard y el simulador funcionan en Mac. La adquisición Bluetooth nativa se delega a [The Balance Toolkit](https://github.com/trecitano/The-Balance-Toolkit); **pendiente de prueba con el dispositivo real**.

1. Instalá/iniciá Toolkit y conectá la Balance Board desde su interfaz.
2. Agregala a una sesión, habilitá **TCP raw** y comenzá la grabación de Toolkit.
3. Ejecutá:

```sh
SOURCE=toolkit npm run dev
```

O, después de compilar, `SOURCE=toolkit npm start`.

Se consume `localhost:11223`: paquetes binarios de 40 bytes, big endian (`i64 timestamp_us`, `u64 MAC`, seis `f32`: TR, BR, TL, BL, CoP X, CoP Y). Los cuatro valores de carga están en kg equivalentes; nuestro servicio vuelve a calcular CoP y no utiliza el stream procesado de 11224. El ensamblador tolera paquetes TCP fragmentados o concatenados.

Variables opcionales: `TOOLKIT_HOST`, `TOOLKIT_PORT`, `TOOLKIT_BOARD_ID` (MAC sin dos puntos). Se selecciona una sola tabla: la indicada o la primera recibida en esa conexión. No se mezclan dos plataformas en una serie. Toolkit no entrega cuentas originales por este stream; se guardan como `null`. Su timestamp se conserva con `timestampSource: "toolkit"`, sin afirmar que proviene del hardware.

## Calibración y límites de las métricas

1. Superficie rígida y nivelada, cuatro apoyos bien asentados. Comprobá que el tamaño de la tabla permita tu stance sin modificarlo.
2. Con la tabla vacía, hacé tara. Se requieren al menos 20 muestras, un intervalo de 0,8 s y lecturas estables; se rechaza si la carga residual supera aproximadamente 5 kg. No se permite tarar la simulación cargada.
3. Comprobá una masa conocida en el centro y distintas posiciones. Esta verificación es manual; todavía no existe un asistente de ajuste multipunto.
4. Quieto sobre la tabla, tomá tu peso de referencia para %BW. También podés ingresarlo manualmente.
5. Para coordenadas en mm, medí la separación entre centros de sensores y marcá que la verificaste. **433 × 238 mm son valores nominales iniciales, no una medición certificada del equipo.** Hasta verificarlos, se muestran solo coordenadas normalizadas, expresadas como porcentaje del semieje.

Convención de la tabla: X positivo a la derecha, Y positivo hacia el borde superior del dibujo. No hay transformación al sistema de ejes del golfista ni detección automática de pie adelantado/atrasado.

```text
Fᵢ [N] = (kgᵢ de fábrica − taraᵢ) × 9,80665
Fz = suma de las cuatro fuerzas
kg equivalentes = Fz / 9,80665
%BW = 100 × Fz / (masa corporal de referencia × 9,80665)
CoP.x = (TR + BR − TL − BL) / Fz
CoP.y = (TL + TR − BL − BR) / Fz
```

- El **centro de presión no es el centro de masa**.
- La suma de apoyos de una mitad **no equivale a la fuerza de ese pie**.
- Cuatro sensores no generan un mapa de presión plantar.
- Solo se mide carga vertical. No hay fuerzas horizontales, torque de giro ni evento de impacto detectado.
- El CoP es `null` debajo de 30 N o si un apoyo tiene una lectura significativamente negativa. La tara conserva valores negativos pequeños en vez de ocultar el ruido.
- Se guardan las muestras sin filtrado temporal ni remuestreo. La trayectoria del CoP muestra los últimos 2 s y el gráfico los últimos 8 s. No hay garantía de frecuencia uniforme ni de captura de picos de impacto.
- Los timestamps Wii corresponden a la recepción en el host, no a un reloj de adquisición de la tabla. La secuencia es local: no permite contar pérdidas dentro del enlace Bluetooth.
- Se registra una plataforma. Dos tablas y la sincronización con vídeo o un launch monitor quedan como extensión futura.

## Arquitectura e integración futura con Open-FP

```text
python/bridge.py ── NDJSON ─┐
Toolkit ── TCP raw ────────┼─ server/sources.ts → controller → WebSocket → TanStack Start
Simulador TypeScript ──────┘                          └─ JSON / CSV locales
```

`shared/protocol.ts` es el contrato de muestras y capacidades actuales; `server/metrics.ts` contiene la conversión física. Cada captura guarda fuente, reloj original, secuencia local, cuentas disponibles, fuerzas, CoP y una copia de su configuración. No se permiten cambios de calibración durante una grabación. Si cambia el ID de conexión de la fuente, la captura se termina sin mezclar relojes.

[Open-FP](https://github.com/open-flight/open-fp) se usó como referencia conceptual para Fz, CoP, %BW y separación entre adquisición y UI. **No existe integración con Open-FP todavía.** Una futura fuente deberá mapear su protocolo y ampliar el contrato a dos plataformas, con posición, orientación y reloj; no se deben inventar ocho canales a partir de cuatro.

## API local

- `GET /api/status`: fuente, conexión, frecuencia, edad de última muestra, descartes, configuración y captura activa.
- `PUT /api/config`: referencia y geometría; esquema validado.
- `POST /api/tare`, `POST /api/reference`: calibración controlada.
- `POST /api/recordings/start`, `POST /api/recordings/stop`.
- `GET /api/recordings`, `GET /api/recordings/:id`, `GET /api/recordings/:id/csv`.
- `WS /stream`: mensajes `{type:"batch",samples:[...]}` a 30 Hz y estado a 4 Hz.

El CSV contiene secuencia, tiempo relativo, timestamp original, conexión, Fz, carga equivalente, %BW, CoP normalizado/físico, fuerzas por apoyo y cuentas originales disponibles. El JSON conserva la configuración y la fuente; exportalo junto al CSV para mantener toda la procedencia.

Datos: `data/config.json` y `data/<uuid>.json`; ignorados por Git. Para usar otro destino: `DATA_DIR=/ruta/absoluta`.

## Verificación

```sh
npm run typecheck
npm test
npm run build
npm run test:production
```

Las pruebas cubren fuerzas/CoP, orientación, calibración de fábrica, ausencia de carga, tara, persistencia, invariancia de configuración durante capturas, protocolo Toolkit, fragmentación TCP y recorrido HTTP/WebSocket/CSV. La UI se verificó en escritorio y móvil con datos simulados. El build de producción se comprobó sirviendo SSR y API desde un solo proceso. La precisión mecánica, el emparejamiento Bluetooth y la operación prolongada sobre Raspberry Pi requieren pruebas con hardware real.

Referencias: [protocolo WiiBrew](https://wiibrew.org/wiki/Wii_Balance_Board), [wiibalance](https://github.com/bboonstra/wiibalance), [The Balance Toolkit](https://github.com/trecitano/The-Balance-Toolkit), [Open-FP](https://github.com/open-flight/open-fp), [TanStack Start](https://tanstack.com/start/latest/docs/framework/react/overview).
