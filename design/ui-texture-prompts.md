# Texturas tileables de la UI: receta para Nano Banana 2

Esta receta funcionó a la primera con `art/ui/ui-stone-wall.jpg`. Úsala para todas las texturas que tengan que repetirse.

Cada prompt tiene cinco partes, y se pega entero, tal cual:

1. **Encargo.** Textura cuadrada 1:1 que se repite como papel pintado.
2. **Sujeto.** Formas orgánicas e irregulares. Cada pieza es distinta, con bordes torcidos y esquinas gastadas. El brillo es el mismo en toda la imagen.
3. **Estilo.** Pintado a mano, vista frontal plana y luz uniforme, sin degradado de un borde a otro.
4. **Tiling.** Es el requisito más importante. Hay que decir explícitamente que lo que corta el borde superior sigue en el inferior, y que lo que corta el borde izquierdo sigue en el derecho.
5. **Avoid.** Nano Banana no tiene campo de negativo, así que lo que no queremos va aquí. Siempre incluye rectángulos, ángulos rectos, líneas paralelas, rejilla y simetría.

Si un resultado no encaja en un eje, el arreglo es este: desplázalo un 50 % e iguala el tono por código. Después, pídele a Nano Banana que repinte solo la cruz central, con el prompt de edición del final.

## ui-stone-wall (fondo de paneles)

```
Create a square 1:1 seamless tileable texture for a fantasy game UI background, designed to repeat in both directions like wallpaper.

Subject: an old hand-built wall of only five or six very large pale white limestone stones, off-white and light warm grey. The stones are irregular polygons with five to seven sides each, rough-hewn and organic, like flagstones fitted together by hand: no two stones share the same shape, edges are slightly bent and wobbly, corners are worn and rounded, some corners are broken off. The joints between stones run at varied angles, they are crooked and uneven, and their width changes along their length. Small chips along the edges, hairline cracks, a few tiny moss specks in the joints. The stone faces are mostly plain, low contrast, with the same color and brightness on every stone.

Style: hand-painted, painterly but clean, like a polished fantasy mobile game UI. Orthographic front view, perfectly flat, facing the camera. Soft, flat, even lighting with no gradient across the image: the top, bottom, left and right edges are exactly as bright as the center. Subtle ambient occlusion only inside the joints.

Tiling is the most important requirement: the image must wrap perfectly in both directions. Every stone or joint cut by the top edge continues exactly at the bottom edge, and every stone or joint cut by the left edge continues exactly at the right edge, at the same position and thickness. No border, frame, vignette or darker edges.

Avoid: rectangles, rectangular blocks, right angles, straight parallel joints, horizontal courses or rows, brick pattern, regular grid, symmetry, sandstone, sand, yellow, orange, terracotta, red clay, saturated colors, small stones, many stones, text, letters, numbers, watermark, logo, perspective, 3D render, photorealism, blur, light gradients.
```

## ui-stone-smooth (cara de losas y botones claros)

```
Create a square 1:1 seamless tileable texture for a fantasy game UI surface, designed to repeat in both directions like wallpaper.

Subject: one continuous surface of smooth weathered pale white limestone, off-white and light warm grey, with no joints and no separate stones. Organic, irregular variation only: soft worn patches of slightly different shapes, faint chisel marks running at random angles, two or three hairline cracks that wander and branch, a few tiny pits. Nothing stands out; the surface is mostly plain, low contrast, with the same brightness everywhere.

Style: hand-painted, painterly but clean, like a polished fantasy mobile game UI. Orthographic front view, perfectly flat, facing the camera. Soft, flat, even lighting with no gradient across the image: the top, bottom, left and right edges are exactly as bright as the center.

Tiling is the most important requirement: the image must wrap perfectly in both directions. Every mark or crack cut by the top edge continues exactly at the bottom edge, and every mark or crack cut by the left edge continues exactly at the right edge. No border, frame, vignette or darker edges.

Avoid: joints, blocks, bricks, tiles, rectangles, straight lines, parallel lines, regular grid, repeating motifs, symmetry, sandstone, sand, yellow, orange, saturated colors, text, letters, numbers, watermark, logo, perspective, 3D render, photorealism, blur, light gradients.
```

## ui-slate (placas oscuras: botones secundarios y campo de texto)

```
Create a square 1:1 seamless tileable texture for a fantasy game UI surface, designed to repeat in both directions like wallpaper.

Subject: one continuous surface of dark charcoal slate with a faint cool iron sheen, with no joints and no separate stones. Organic, irregular variation only: thin flaky layers with wavy edges, faint grain lines that drift at slightly different angles, soft worn patches, two or three hairline cracks that wander. Nothing stands out; the surface is mostly plain, very low contrast, with the same darkness everywhere.

Style: hand-painted, painterly but clean, like a polished fantasy mobile game UI. Orthographic front view, perfectly flat, facing the camera. Soft, flat, even lighting with no gradient across the image: the top, bottom, left and right edges are exactly as dark as the center.

Tiling is the most important requirement: the image must wrap perfectly in both directions. Every grain line, layer or crack cut by the top edge continues exactly at the bottom edge, and every one cut by the left edge continues exactly at the right edge. No border, frame, vignette or lighter edges.

Avoid: joints, blocks, tiles, rectangles, straight lines, parallel lines, regular grid, repeating motifs, symmetry, light colors, blue, saturated colors, text, letters, numbers, watermark, logo, perspective, 3D render, photorealism, blur, light gradients.
```

## ui-gold (cara del botón principal)

```
Create a square 1:1 seamless tileable texture for a fantasy game UI surface, designed to repeat in both directions like wallpaper.

Subject: one continuous surface of warm burnished gold leaf laid over stone, with no joints and no shapes. Organic, irregular variation only: soft brushed highlights sweeping at random angles, gently worn patches of different sizes where a hint of pale stone shows through, a few tiny dents and scratches. Nothing stands out; the surface is low contrast, with the same brightness everywhere.

Style: hand-painted, painterly but clean, like a polished fantasy mobile game UI. Orthographic front view, perfectly flat, facing the camera. Soft, flat, even lighting with no gradient across the image and no hotspot: the top, bottom, left and right edges are exactly as bright as the center.

Tiling is the most important requirement: the image must wrap perfectly in both directions. Every highlight, worn patch or scratch cut by the top edge continues exactly at the bottom edge, and every one cut by the left edge continues exactly at the right edge. No border, frame, vignette or darker edges.

Avoid: ornaments, patterns, engravings, rectangles, straight lines, parallel lines, regular grid, symmetry, orange, copper, saturated yellow, glitter, sparkles, lens flare, text, letters, numbers, watermark, logo, perspective, 3D render, photorealism, blur, light gradients.
```

## ui-strap (tira de hierro lateral, se repite solo en vertical)

```
Create a tall narrow 9:16 image of a seamless vertically tileable game UI element, designed to repeat from top to bottom.

Subject: one narrow wrought iron strap running straight down the center, about one fifth of the image wide, on a perfectly flat magenta #FF00FF background. The iron is hand-forged and organic: the strap's edges are slightly wavy and uneven, its width varies a little along its length, with hammer marks, light rust patches of different shapes, and three round rivets at irregular spacing, each rivet slightly different.

Style: hand-painted, painterly but clean, like a polished fantasy mobile game UI. Orthographic front view, perfectly flat, facing the camera. Soft, flat, even lighting from the top-left, with no gradient from top to bottom. The magenta background has no shadow, texture or gradient.

Tiling is the most important requirement: the strap must wrap perfectly from top to bottom. The strap is cut by the top edge and the bottom edge at exactly the same position, width and color, so stacked copies form one continuous strap. Nothing touches the left or right edges.

Avoid: brackets, hinges, corners, chains, ornaments, perfectly straight ruler edges, evenly spaced rivets, symmetry, shadow on the background, text, letters, numbers, watermark, logo, perspective, 3D render, photorealism, blur, light gradients.
```

## Edición: cerrar una unión que no encaja

Pasa la imagen ya desplazada un 50 % (te la preparo yo) junto con este texto:

```
This is a tileable texture shifted by half. There is a visible seam: a horizontal line and a vertical line crossing at the center, where shapes and lines do not connect. Repaint only a narrow band around those two center lines so everything connects naturally across them. Keep everything else exactly identical, especially the outer edges. Same style, colors and lighting.
```
