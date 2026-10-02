# Nutri Guía Clínica

Aplicación web instalable para organizar fichas y crear borradores de menús semanales para revisión clínica. Está escrita en español y pensada para prácticas en Resistencia, Chaco.

## Abrir en Windows

1. Hacé doble clic en **iniciar-app.bat**.
2. El iniciador buscará Node.js automáticamente. Si ya tenés una clave de OpenAI API, pegala cuando la ventana la pida. La clave no se guarda en un archivo y solo se mantiene mientras esa ventana esté abierta. Si presionás Enter sin escribir una clave, podés explorar la app y guardar fichas, pero no generar menús con IA.
3. Se abrirá la app en el navegador. Para detenerla, cerrá la ventana negra.

Si el iniciador dice que no encuentra Node.js, instalalo desde [nodejs.org](https://nodejs.org/) y volvé a abrir **iniciar-app.bat**.

La API de OpenAI requiere una clave y puede tener cargos propios de uso. El acceso a ChatGPT no configura automáticamente una clave para esta aplicación. La app usa GPT-6 Luna por defecto para reducir el costo de generación; en un alojamiento propio, un administrador puede elegir otro modelo mediante la configuración `OPENAI_MODEL`.

El botón **Guardar o imprimir PDF** prepara la descarga con el formato semanal compartido por Lucas, sus recomendaciones, el recetario complementario y la selección de alimentos. El menú conserva las ideas generadas y los cambios editados en la ficha. El texto de la interfaz también se amplió para facilitar la lectura.

La ficha ahora permite buscar pacientes por nombre, objetivo o identificador interno, archivar y reactivar registros, llevar un historial de consultas y guardar mediciones de peso, talla y perímetros. Podés cargar las mediciones iniciales al crear la ficha y registrar las nuevas junto con cada consulta. El IMC se calcula cuando hay peso y talla y se muestra como un dato descriptivo, no como diagnóstico. Al crear un menú nuevo se conserva el borrador anterior para poder restaurarlo. Desde **Mis pacientes** también se pueden descargar e importar respaldos JSON; la importación suma fichas nuevas y no reemplaza las existentes.

Si la app muestra un error al generar, cerrá la ventana negra y volvé a iniciar **iniciar-app.bat** para cargar la versión actualizada. Si el mensaje menciona saldo, facturación o límites, revisá el uso y la facturación de la API en la cuenta y el proyecto asociados a la clave; comprar crédito no corrige un error de lectura de la respuesta como el que ya fue corregido en esta versión.

## Cálculo de requerimientos para el menú

El cálculo usa la ecuación revisada de Harris-Benedict de Roza y Shizgal (1984). Se aplica a personas adultas y requiere edad, peso, talla y una categoría de fórmula femenina o masculina. Las ecuaciones usan kg, cm y años:

- Categoría masculina: 88,362 + (13,397 × peso) + (4,799 × talla) − (5,677 × edad).
- Categoría femenina: 447,593 + (9,247 × peso) + (3,098 × talla) − (4,330 × edad).

La aplicación multiplica el resultado en reposo por un factor de actividad seleccionado por el profesional: 1,2; 1,375; 1,55; 1,725 o 1,9. Es una forma aproximada de estimar el gasto diario; esos factores son estimaciones separadas de Harris-Benedict. El objetivo del menú parte del gasto diario y permite un ajuste manual profesional. La app no decide por sí sola un déficit o superávit según el objetivo escrito en la ficha.

La referencia de macronutrientes queda fijada en 60% de carbohidratos, 25% de grasas y 15% de proteínas. Estos porcentajes están dentro de los rangos de distribución para adultos publicados por las National Academies, pero no necesariamente son adecuados para cada situación clínica. La IA recibe el objetivo energético estimado y esos porcentajes; redacta medidas caseras, sin gramos por alimento, calorías ni porcentajes en el menú. El peso, la talla, la categoría usada en la ecuación y el factor de actividad permanecen en este dispositivo.

Harris-Benedict es una predicción, no una medición: la publicación informa una precisión del 14% en personas con estado nutricional normal y advierte que no es fiable en desnutrición. Revisá el resultado profesionalmente; la app no aplica esta estimación para embarazo, enfermedad aguda o menores.

Fuentes: [Roza y Shizgal (1984), artículo sobre Harris-Benedict](https://pubmed.ncbi.nlm.nih.gov/6741850/); [National Academies, rangos de distribución de macronutrientes](https://www.nationalacademies.org/index.php/cdn/materials/9fb9fae6-337c-4b7c-9821-2c81d1f65ad0).
## Instalarla en un celular

Este archivo ZIP contiene la aplicación lista para publicarse y probarse. Para que Android o iPhone la instalen como app hace falta primero publicarla en una dirección web HTTPS. Abrir el ZIP o el archivo HTML directamente en el teléfono no instala una PWA y tampoco habilita la generación de menús.

Cuando tengas una dirección HTTPS:

- **Android:** abrí el enlace en Chrome y tocá **Instalar app**. También podés usar el menú ⋮ y elegir **Instalar app** o **Añadir a pantalla de inicio**.
- **iPhone:** abrí el enlace en Safari, tocá **Compartir** y elegí **Agregar a pantalla de inicio**.

El servicio donde publiques la app deberá ejecutar Node.js 20 o posterior y tener estos secretos: `NODE_ENV=production`, `OPENAI_API_KEY` y una `APP_PASSWORD` privada de al menos 16 caracteres. El acceso con contraseña caduca a las 12 horas. No pegues claves en el navegador, en este ZIP ni en mensajes. Antes de usar datos de pacientes, revisá que el alojamiento sea adecuado para información de salud y esté configurado para no registrar los cuerpos de las solicitudes. El servidor y su proveedor procesan las solicitudes antes de enviarlas a OpenAI. El navegador del celular guardará sus propias fichas localmente; no se sincronizan con la computadora.

## Datos y privacidad

- Las fichas y los borradores se guardan en el almacenamiento local del navegador de cada dispositivo. No hay cuenta ni sincronización.
- Al pedir un menú, el servidor recibe edad, condición de salud, objetivo, gustos, restricciones, presupuesto, rutina y, si está calculado, el gasto diario y la distribución objetivo de macros. El peso, la talla, la categoría de la ecuación, el nombre y otros datos de identificación no se envían. El servidor reenvía el contexto mínimo a OpenAI para preparar la respuesta.
- Podés guardar una ficha sin permiso para usar IA; antes de cada caso nuevo la app requiere registrar que la persona fue informada y autorizó ese uso. Revisá las reglas de privacidad de tu institución, el consentimiento apropiado y las condiciones actuales del alojamiento y del proveedor antes de usar datos reales.
- No se incluyen menores, diagnósticos automáticos ni ajustes de medicamentos. La estimación energética y la distribución de macros son ayudas editables para revisión profesional; no interpretan resultados.
- El borrador es una ayuda educativa, no una indicación clínica lista para entregar. Revisalo con el profesional supervisor, especialmente si hay alergias, comorbilidades, tratamiento u otras necesidades que exceden el alcance inicial.

## Respaldo

Las fichas pertenecen al almacenamiento del navegador y podrían perderse si se borra ese almacenamiento, se cambia de navegador o se cambia de teléfono. Por privacidad, esta primera versión no sincroniza ni hace copias en la nube. Evitá cargar datos identificables y protegé el acceso al dispositivo.

## Agenda y seguimiento

La agenda permite organizar turnos en vista diaria, semanal o mensual, asociarlos a una ficha, editar fecha y duración, cambiar su estado y cancelarlos con confirmación. Se previenen las superposiciones de horarios entre turnos activos. Los turnos se guardan localmente en el navegador y se incluyen en los respaldos nuevos. No se envían avisos por email, WhatsApp ni SMS; la app muestra turnos próximos en el inicio. El tablero también señala controles vencidos y fichas sin consultas registradas.

El servidor ahora publica `GET /api/health` para comprobar que está activo. Se aplican límites por dirección de red a los intentos de inicio de sesión y generación de menús; estos límites se reinician al reiniciar el servidor. La agenda, las fichas y sus permisos todavía no están sincronizados entre profesionales ni entre dispositivos.

## Desarrollo

Requiere Node.js 20 o posterior. Desde esta carpeta ejecutá `node server.mjs` y abrí `http://localhost:4173`. La clave se recibe como `OPENAI_API_KEY` en el entorno del servidor y nunca se incluye en JavaScript del navegador.
