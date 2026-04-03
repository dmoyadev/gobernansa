<template>
	<svg
		class="auth-bg"
		height="280"
		viewBox="0 0 500 260"
		xmlns="http://www.w3.org/2000/svg"
	>
		<defs>
			<path
				id="path"
				d="M295,253 C326,265 348,260 361,238 L361,0 L0,0 C165,157 263,242 295,253 Z"
			/>
		</defs>
		<g stroke="none">
			<mask
				id="mask"
				fill="white"
			>
				<use xlink:href="#path" />
			</mask>
			<image
				mask="url(#mask)"
				x="0"
				y="-70"
				width="500"
				height="400"
				xlink:href="/auth-bg.jpg"
			/>
		</g>
	</svg>
</template>
