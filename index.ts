export class RollingHash {
	primeBase: number;
	primeMod: number;
	lastPower: number;
	lastBuffer: Buffer;
	lastHash: number;
	constructor() {
		this.primeBase = 257;
		this.primeMod = 1000000007;
		this.lastPower = 0;
		this.lastBuffer = Buffer.from([]);
		this.lastHash = 0;
	}

	private moduloExp(base: number, power: number, modulo: number) {
		let toReturn = 1;
		for (let i = 0; i < power; i += 1) {
			toReturn = (base * toReturn) % modulo;
		}
		return toReturn;
	}

	hash(toHash: Buffer) {
		let hash = 0;
		const len = toHash.length;
		for (let i = 0; i < len; i += 1) {
			hash += (toHash[i] * this.moduloExp(this.primeBase, len - 1 - i, this.primeMod)) % this.primeMod;
			hash %= this.primeMod;
		}
		this.lastPower = this.moduloExp(this.primeBase, len - 1, this.primeMod);
		this.lastBuffer = toHash;
		this.lastHash = hash;
		return hash;
	}

	nextHash(toAdd: number) {
		let hash = this.lastHash;
		const lsArray = this.lastBuffer;
		hash -= (lsArray[0] * this.lastPower);
		hash = hash * this.primeBase + toAdd;
		hash %= this.primeMod;
		if (hash < 0) {
			hash += this.primeMod;
		}
		;
		this.lastBuffer = Buffer.concat([lsArray.slice(1), Buffer.from([toAdd])]);
		this.lastHash = hash;
		return hash;
	}
}

export class Block {
	buffer: Buffer;
	offset: number;
	nextBlock: Block;
	constructor(buffer: Buffer, offset: number) {
		this.buffer = buffer;
		this.offset = offset;
		this.nextBlock = null;
	}
}

export class BlockBuffer {
	originalBuffer: Buffer;
	blockSize: number;
	blocks: Block[];
	constructor(originalBuffer: Buffer, blockSize: number) {
		this.originalBuffer = originalBuffer;
		this.blockSize = blockSize;
		this.blocks = [];

		const len = originalBuffer.length;
		for (let i = 0; i < len; i += blockSize) {
			const endIndex = i + blockSize >= len ? len : i + blockSize;
			this.blocks.push(new Block(originalBuffer.slice(i, endIndex), i));
		}
	}
}

export class Dictionary {
	dictionary: { [key: number]: Block[] };
	dictionaryBuffer: BlockBuffer;
	constructor() {
		this.dictionary = {};
		this.dictionaryBuffer = null;
	}

	put(key: number, block: Block) {
		if (!this.dictionary.hasOwnProperty(key)) {
			this.dictionary[key] = [];
		}
		this.dictionary[key].push(block);
	}

	populateDictionary(dictionaryBuffer: BlockBuffer, hasher: RollingHash) {
		this.dictionary = {};
		this.dictionaryBuffer = dictionaryBuffer;
		const blocks = dictionaryBuffer.blocks
		for (let i = 0, len = blocks.length; i < len; i += 1) {
			this.put(hasher.hash(blocks[i].buffer), blocks[i]);
		}
	}

	getMatch(hash: number, blockSize: number, target: Buffer) {
		if (this.dictionary.hasOwnProperty(hash)) {
			let blocks = this.dictionary[hash];
			for (let i = 0, len = blocks.length; i < len; i += 1) {
				if (blocks[i].buffer.equals(target.slice(0, blockSize))) {
					if (this.dictionaryBuffer !== null && blocks[i].nextBlock === null) {
						let dictBuffer = this.dictionaryBuffer.originalBuffer.slice(blocks[i].offset + blockSize);
						let targetBuffer = target.slice(blockSize);
						if (dictBuffer.length === 0 || targetBuffer.length === 0) {
							return blocks[i];
						}
						let currentPointer = 0;
						while (currentPointer < dictBuffer.length && currentPointer < targetBuffer.length &&
							dictBuffer[currentPointer] === targetBuffer[currentPointer]) {
							currentPointer += 1;
						}
						return new Block(Buffer.concat([blocks[i].buffer, dictBuffer.slice(0, currentPointer)]), blocks[i].offset);
					} else if (blocks[i].nextBlock !== null) {
						return blocks[i];
					} else {
						return blocks[i];
					}
				}
			}
			return null;
		}
		return null;
	}
}

const header = Buffer.from([
	// VCD\0
	0xd6,
	0xc3,
	0xc4,
	0x00,
	// No VCD_DECOMPRESS/VCD_CODETABLE is supported
	0b00000000
]);

type IDiff = (Buffer | number)[];
export class VCdiff {
	hash: RollingHash;
	dictBuffer: Dictionary;
	blockSize: number;
	constructor(hasher: RollingHash = new RollingHash(), dictBuffer: Dictionary = new Dictionary()) {
		this.hash = hasher;
		this.dictBuffer = dictBuffer
		this.blockSize = 20;
	}

	encode(dict: Buffer, target: Buffer): IDiff {
		if (dict.equals(target)) {
			return [];
		}
		const diff: IDiff = [];
		let addBuffer: Buffer = Buffer.from([]);
		this.dictBuffer.populateDictionary(new BlockBuffer(dict, this.blockSize), this.hash);
		let targetLength = target.length;
		let targetIndex = 0;
		let currentHash = -1;
		while (targetIndex < targetLength) {
			if (targetLength - targetIndex < this.blockSize) {
				diff.push(Buffer.concat([addBuffer, target.slice(targetIndex, targetLength)]));
				break;
			} else {
				if (currentHash === -1) {
					currentHash = this.hash.hash(target.slice(targetIndex, targetIndex + this.blockSize));
				} else {
					// I am not sure about this line (Bug in initial source code?)
					currentHash = this.hash.nextHash(target[targetIndex + (this.blockSize - 1)]);
					if (currentHash < 0) {
						currentHash = this.hash.hash(target.slice(0, targetIndex + this.blockSize));
					}
				}
				let match = this.dictBuffer.getMatch(currentHash, this.blockSize, target.slice(targetIndex));
				if (match === null) {
					addBuffer = Buffer.concat([addBuffer, Buffer.from([target[targetIndex]])]);
					targetIndex += 1;
				} else {
					if (addBuffer.length > 0) {
						diff.push(addBuffer);
						addBuffer = Buffer.from([]);
					}
					diff.push(match.offset);
					diff.push(match.buffer.length);
					targetIndex += match.buffer.length;
					currentHash = -1;
				}
			}
		}
		return diff;
	}

	decode(dict: Buffer, diff: IDiff): Buffer {
		const output: Buffer[] = [];
		if (diff.length === 0) {
			return dict;
		}
		for (let i = 0; i < diff.length; i += 1) {
			if (typeof diff[i] === 'number') {
				output.push(dict.slice(diff[i] as number, (diff[i] as number) + (diff[i + 1] as number)));
				i += 1;
			} else if (diff[i] instanceof Buffer) {
				output.push(diff[i] as Buffer);
			}
		}
		return Buffer.concat(output);
	}
}
