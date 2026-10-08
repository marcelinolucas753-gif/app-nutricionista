# Nutri Guía Clínica

Aplicación web en español para que profesionales de nutrición organicen pacientes, consultas, mediciones, agenda y borradores de alimentación.

## Qué incorpora esta versión

- Acceso individual por profesional: cada cuenta ve únicamente sus fichas. Los datos se sincronizan entre dispositivos mediante una base PostgreSQL central.
- Respaldo automático diario cifrado. Se conservan los últimos 14 respaldos diarios y uno por semana durante 8 semanas. La clave de cifrado es irremplazable: guardala aparte y con acceso restringido.
- Asistente para resumir consultas y preparar preguntas de seguimiento.
- Reemplazo de una comida puntual sin regenerar el resto del menú, recetas con medidas caseras y sugerencias de sustitución.
- Todo lo creado con IA queda como propuesta para revisión. El PDF para pacientes solo se habilita después de aprobar el plan. Luego lo descargás y elegís por qué medio compartirlo.
- Ningún alimento se excluye de forma automática. La IA considera las alergias, intolerancias y preferencias anotadas en esa ficha. Revisá etiquetas y contaminación cruzada cuando corresponda.
- Los menús usan medidas caseras y evitan cantidades en gramos por ingrediente. La estimación Harris-Benedict y la distribución 60% carbohidratos, 25% grasas y 15% proteínas continúan siendo referencias para revisión profesional.

### Novedades de la versión 12

- **Alergias e intolerancias** como campo propio de la ficha. Cada menú, comida, receta y plantilla se revisa contra esas alergias y contra lo que la persona evita; las coincidencias se marcan en rojo. Aprobar un plan con coincidencias exige una confirmación explícita y queda en el historial. La revisión busca palabras: no reemplaza la lectura profesional ni detecta ingredientes ocultos.
- **Avisos por WhatsApp** (turnos, acceso al portal y lista de compras): la app abre WhatsApp con el mensaje armado; la profesional toca «Enviar». No hay envío automático.
- **Gráficos** de peso, cintura y cadera en la ficha y en el portal.
- **Metas** por persona, con opción de mostrarlas en su portal.
- **Lista de compras** semanal armada con IA a partir del menú, visible en el portal cuando el plan está aprobado.
- **Plantillas de menú** reutilizables.
- **Historial de cambios** por ficha (últimos 300 movimientos).
- **Portal del paciente**: el enlace se canjea por una sesión de 30 días y se borra de la barra de direcciones; los pesos enviados quedan pendientes hasta que la profesional los acepta o descarta.
- **Cambio de contraseña** en una ventana propia (ya no con cuadros de texto del navegador).
- **Aviso de respaldos** en el inicio si no están activos o están desactualizados.
- Si dos dispositivos guardan a la vez, ya no se pierde el último cambio: se descarga una copia antes de cargar la versión más reciente.

## Menús más prácticos y de la zona

Las reglas que guían a la IA están en `menu-rules.mjs`. La primera parte del archivo es solo texto y se puede corregir sin programar:

- Alimentos habituales de la zona y alimentos que no se usan por caros o poco comunes.
- Cómo deben ser el desayuno, la merienda y las colaciones (simples y rápidos).
- Qué hacer según dónde almuerza la persona (campo nuevo en la ficha).
- Pauta de sábado y domingo (almuerzo y cena libres) y recomendaciones base por condición.
- Palabras que delatan una preparación elaborada: si la IA las usa en el desayuno o la merienda, la app pide una versión más simple una vez; si insiste, el borrador se entrega con un aviso en las notas de revisión.

Los textos fijos de fin de semana y recomendaciones base no nombran alimentos a propósito, para que nunca choquen con alergias o alimentos que la persona evita. Todo sigue siendo un borrador para revisión profesional.

## Probar en una computadora

La aplicación requiere Node.js 20.6 o posterior, npm y Docker Desktop para iniciar una base local de prueba.

1. Copiá `.env.example` como `.env`. Abrilo y reemplazá `BACKUP_ENCRYPTION_KEY` por una clave propia de 64 caracteres hexadecimales. Podés generar una con Node: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
2. Instalá los componentes necesarios con `npm install`.
3. Iniciá la base de prueba con `docker compose up -d`.
4. En PowerShell, desde esta carpeta, ejecutá `node --env-file=.env migrate.mjs`.
5. Creá una cuenta profesional: `node --env-file=.env manage-users.mjs create correo@ejemplo.com "Nombre Profesional"`. Copiá la contraseña temporal que aparece y guardala en un lugar privado. Después podés cambiarla desde la app.
6. Iniciá la aplicación con `iniciar-app.bat` e ingresá con ese correo y contraseña.
7. Para activar las funciones de IA, cargá una clave de OpenAI en `OPENAI_API_KEY` dentro de `.env` y reiniciá la aplicación. La clave de API puede tener costos propios; no es la contraseña de ChatGPT.

Para agregar otros profesionales, repetí el paso 5 con su correo y nombre. Para restablecer una contraseña: `node --env-file=.env manage-users.mjs reset-password correo@ejemplo.com`. Para recuperar datos: `node --env-file=.env restore-backup.mjs ruta/al/respaldo.enc`; escribí `RESTAURAR` cuando lo pida. Antes de restaurar se crea un respaldo cifrado de seguridad.

Las credenciales de PostgreSQL incluidas en `docker-compose.yml` son solo para la base local de prueba. No las reutilices para publicar la aplicación.

## Publicar y usar desde varios dispositivos

La aplicación está preparada para ejecutarse en un servidor Node.js con una base PostgreSQL accesible, conexión HTTPS, almacenamiento persistente para los archivos de respaldo y acceso limitado a las claves. La separación de fichas se aplica dentro de la base de datos y se verifica también con políticas de seguridad de PostgreSQL. La app no crea por sí sola el servicio de alojamiento ni la base remota; antes de cargar datos reales, un administrador debe configurarlos y comprobarlos.

Configuración necesaria en el servidor: `NODE_ENV=production`, `DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_DIR` persistente y, para IA, `OPENAI_API_KEY`. Configurá HTTPS en el servicio que publica la app. Guardá una copia protegida de la clave de respaldo fuera del servidor: sin ella no es posible recuperar los archivos cifrados. Probá restaurar los respaldos antes de usar el sistema con información real.

La base mantiene datos separados por cuenta profesional dentro del mismo servicio PostgreSQL. No se crea una instancia física distinta para cada profesional.

## Privacidad y uso de IA

- La app requiere una cuenta para abrir fichas. Las contraseñas se almacenan como verificaciones criptográficas; las sesiones vencen a las 12 horas.
- El profesional debe contar con autorización para cada paciente antes de usar cualquier función de IA. La autorización actualizada cubre menús, resúmenes de consulta, reemplazos, recetas y sustituciones.
- Se envía a OpenAI solo el contexto necesario para la función solicitada. El nombre y el correo del paciente no se agregan al contexto; evitá escribir datos identificatorios dentro de las observaciones clínicas.
- Cada respuesta de IA es una propuesta. La revisión profesional, las alergias, medicación y necesidades individuales deben comprobarse antes de compartir.
- Compartir no envía correos ni mensajes automáticamente. La función prepara la impresión o el guardado como PDF; el profesional elige el medio.
- Un cambio de datos desde otro dispositivo se detecta para evitar reemplazar silenciosamente una versión más reciente.

## Migrar fichas que estaban en este navegador

Al iniciar sesión, si la app encuentra fichas antiguas guardadas en ese navegador, preguntará si querés agregarlas a la cuenta actual. La importación es opcional y suma registros sin reemplazar fichas existentes. Si otro profesional usa ese mismo navegador, elegí **No** para no pasarle esos datos.

También podés descargar e importar un respaldo JSON desde **Mis pacientes**. Los respaldos contienen información de salud: mantenelos en un lugar privado.

## Cálculo energético

La estimación utiliza la ecuación revisada Harris-Benedict de Roza y Shizgal (1984), para personas adultas con edad, peso, talla y categoría de fórmula disponibles. El factor de actividad se aplica como aproximación separada. No es un diagnóstico ni una medición del gasto; el profesional debe revisar supuestos y pertinencia. La app no aplica la estimación automáticamente a menores, embarazo o enfermedad aguda.

La distribución de macronutrientes se fija en 60% carbohidratos, 25% grasas y 15% proteínas como orientación solicitada. Puede no ser adecuada para todos los casos.

Fuentes: [Roza y Shizgal (1984), Harris-Benedict revisada](https://pubmed.ncbi.nlm.nih.gov/6741850/); [National Academies, rangos de macronutrientes](https://www.nationalacademies.org/index.php/cdn/materials/9fb9fae6-337c-4b7c-9821-2c81d1f65ad0).

### Respaldos en Render (importante)

En Render, los archivos del servicio se borran en cada actualización o reinicio, salvo los que estén en un **disco persistente** (requiere un plan de pago). Para que los respaldos sobrevivan: Render → tu servicio → **Disks** → *Add Disk* con ruta de montaje `/var/data`, y en **Environment** agregá `BACKUP_DIR=/var/data/backups`. Después reiniciá el servicio; la app muestra en el Inicio si los respaldos están funcionando.

## Instalar en un celular

Primero debe publicarse en una dirección HTTPS. Android: abrí el enlace en Chrome y elegí **Instalar app**. iPhone: abrilo en Safari, tocá **Compartir** y elegí **Agregar a pantalla de inicio**.

## Desarrollo y mantenimiento

- `node --env-file=.env migrate.mjs`: crea las tablas y políticas de seguridad.
- `node --env-file=.env manage-users.mjs create correo@ejemplo.com "Nombre"`: crea un profesional.
- `node --env-file=.env manage-users.mjs reset-password correo@ejemplo.com`: restablece una contraseña y cierra sus sesiones activas.
- `node --env-file=.env restore-backup.mjs ruta/al/respaldo.enc`: restaura un respaldo cifrado previa confirmación.
- `npm test`: corre las pruebas automáticas (alergias, validaciones, gráficos, contacto, lógica de la ficha).
- `GET /api/health`: informa si la base está disponible, sin exponer información de las fichas.
- Las consultas y guardados deben seguir usando HTTPS y no registrar los cuerpos de solicitudes, que pueden contener datos de salud.
