#!/usr/bin/env bun

const DOWNLOAD_BASE_URL = "https://github.com/mastermakrela/libtailscale/releases/download/2025-02-23";
const assets = [
	"libtailscale-darwin-arm64.dylib",
	"libtailscale-darwin-amd64.dylib",
	"libtailscale-linux-amd64.so",
	"libtailscale-linux-arm64.so",
];

const os = (await Bun.$`uname -s`.text()).trim().toLowerCase();
let arch = (await Bun.$`uname -m`.text()).trim().toLowerCase();
if (arch === "x86_64") arch = "amd64"; // TODO: rename assets to match

// Main CLI function
async function main() {
	const args = Bun.argv.slice(2);

	if (args.length === 0) {
		// Show under construction banner when called without arguments
		console.log(`
    🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧
    
    🏗️  Tailscale JS CLI - Under Construction 🏗️
    
    🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧 🚧
    `);
		return;
	}

	if (args[0] === "get-libtailscale") {
		await downloadLibtailscale();
	} else {
		console.log(`Unknown command: ${args[0]}`);
	}
}

async function downloadLibtailscale() {
	// Determine the default asset based on detected OS and architecture
	let extension = os.includes("darwin") ? "dylib" : "so";
	let defaultAsset = `libtailscale-${os}-${arch}.${extension}`;

	// Check if default asset exists in the assets list
	let defaultAssetIndex = assets.findIndex((asset) => asset === defaultAsset);
	if (defaultAssetIndex === -1) {
		console.log(`No matching asset found for your system (${os}-${arch}). Showing all options.`);
		defaultAssetIndex = 0;
	}

	console.log(`Detected system: ${os}-${arch}`);
	console.log(`Recommended asset: ${assets[defaultAssetIndex]}\n`);

	const downloadConfirm = prompt(`Do you want to download ${assets[defaultAssetIndex]}? (y/n)`);

	// Handle null response (e.g., if user presses Ctrl+C)
	if (downloadConfirm === null) {
		console.log("Operation cancelled by user.");
		return;
	}

	if (downloadConfirm.toLowerCase() !== "y") {
		console.log("\nSelect an alternative asset to download:");

		for (let i = 0; i < assets.length; i++) {
			console.log(`${i + 1}. ${assets[i]}`);
		}

		const selection = prompt("Enter number (1-4):");

		// Handle null response
		if (selection === null) {
			console.log("Operation cancelled by user.");
			return;
		}

		const selectionIndex = parseInt(selection) - 1;

		if (selectionIndex >= 0 && selectionIndex < assets.length) {
			await downloadAsset(assets[selectionIndex]);
		} else {
			console.log("Invalid selection. Download cancelled.");
		}
	} else {
		await downloadAsset(assets[defaultAssetIndex]);
	}
}

async function downloadAsset(asset: string) {
	const downloadUrl = `${DOWNLOAD_BASE_URL}/${asset}`;
	console.log(`Downloading ${asset} from ${downloadUrl}...`);

	try {
		const response = await fetch(downloadUrl);

		if (!response.ok) {
			throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
		}

		const fileData = await response.arrayBuffer();
		await Bun.write(asset, fileData);

		console.log(`Successfully downloaded ${asset}`);
	} catch (error) {
		console.error(`Error downloading asset: ${error}`);
	}
}

// Run the main function
main().catch(console.error);
