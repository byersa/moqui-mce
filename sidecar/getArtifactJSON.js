import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { XMLParser } from 'fast-xml-parser';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * mapXmlToQuasar - The Rosetta Stone for Moqui-to-Quasar mapping.
 */
function mapXmlToQuasar(node, parentId = 'root') {
    if (!node) return [];

    // Normalize into an array if it's a single object from the parser
    const nodes = Array.isArray(node) ? node : [node];

    return nodes.map((n, index) => {
        const tagName = Object.keys(n).find(k => k !== 'mce:intent' && k !== 'id');
        const id = n.id || `${parentId}-${tagName}-${index}`;

        // Define the base component structure for BlueprintClient.js
        const element = {
            id: id,
            component: 'div', // Default
            properties: {},
            children: []
        };

        // Extract mce: clues
        if (n['mce:intent']) element.intent = n['mce:intent'];

        // Moqui Tag to Quasar Component Mapping
        switch (tagName) {
            case 'container-panel':
            case 'container':
                element.component = 'div';
                element.properties.class = 'q-pa-md';
                break;
            case 'label':
                element.component = 'div';
                element.properties.class = n.type === 'h6' ? 'text-h6' : 'text-body1';
                element.properties.text = n.text;
                break;
            case 'button':
                element.component = 'q-btn';
                element.properties.label = n.text;
                element.properties.color = 'indigo';
                break;
            case 'text-line':
            case 'text-area':
                element.component = 'q-input';
                element.properties.outlined = true;
                element.properties.label = n.label || n.name;
                break;
        }

        // Recursively map children if they exist
        const childKeys = Object.keys(n).filter(k => typeof n[k] === 'object');
        childKeys.forEach(key => {
            element.children.push(...mapXmlToQuasar(n[key], id));
        });

        return element;
    });
}
/**
 * mapXmlToQuasar - The core recursive engine.
 * Converts Moqui XML objects into the JSON structure BlueprintClient.js needs.
 */
function mapXmlToQuasar(node) {
    if (!node || typeof node !== 'object') return [];

    // The XML parser might return a single object or an array; normalize to array
    const elements = Array.isArray(node) ? node : [node];

    return elements.map(item => {
        // Find the tag name (e.g., 'container', 'label')
        const tagName = Object.keys(item).find(k => k !== 'id' && !k.startsWith('mce:'));

        const mapped = {
            id: item.id || `gen-${Math.random().toString(36).substr(2, 9)}`, // Ensure every element has a Pulse target
            component: mapTagName(tagName), // Map Moqui -> Quasar
            properties: { ...item }, // Carry over all attributes
            children: []
        };

        // If the tag has nested content, recurse
        if (tagName && typeof item[tagName] === 'object') {
            mapped.children = mapXmlToQuasar(item[tagName]);
        }

        return mapped;
    });
}

/**
 * Helper to map Moqui tags to Quasar/HTML components.
 */
function mapTagName(moquiTag) {
    const map = {
        'container': 'div',
        'container-panel': 'q-card',
        'label': 'div',
        'button': 'q-btn',
        'text-line': 'q-input'
    };
    return map[moquiTag] || 'div';
}

export async function assembleSuperSet(componentName, artifactPath) {
    const baseDir = path.resolve(__dirname, `../runtime/component/${componentName}`);
    const xmlFile = path.join(baseDir, artifactPath);
    const blueprintFile = path.join(baseDir, 'blueprint', artifactPath.replace('.xml', '.md'));

    const xmlRaw = await fs.readFile(xmlFile, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
    const xmlObj = parser.parse(xmlRaw);

    let blueprintMeta = {};
    try {
        const mdRaw = await fs.readFile(blueprintFile, 'utf8');
        const yamlMatch = mdRaw.match(/^---\n([\s\S]*?)\n---/);
        if (yamlMatch) blueprintMeta = yaml.load(yamlMatch[1]);
    } catch (e) {
        console.warn(`No blueprint found for ${artifactPath}`);
    }

    return {
        meta: { title: blueprintMeta.id || path.basename(artifactPath), ...blueprintMeta },
        structure: mapXmlToQuasar(xmlObj.screen?.widgets || xmlObj.widgets), // Start at the widgets root
    };
}