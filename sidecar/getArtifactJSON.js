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

    const nodes = Array.isArray(node) ? node : [node];

    return nodes.map((n, index) => {
        const tagName = Object.keys(n).find(k => k !== 'mce:intent' && k !== 'id');
        const id = n.id || `${parentId}-${tagName}-${index}`;

        const element = {
            id: id,
            component: 'div',
            properties: {},
            children: []
        };

        if (n['mce:intent']) element.intent = n['mce:intent'];

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

        const childKeys = Object.keys(n).filter(k => typeof n[k] === 'object');
        childKeys.forEach(key => {
            element.children.push(...mapXmlToQuasar(n[key], id));
        });

        return element;
    });
}

export async function assembleSuperSet(componentName, artifactPath) {
    // Correcting the path to reach back to Moqui runtime from the sidecar/mcp-host folders
    const baseDir = path.resolve(__dirname, `../../../../runtime/component/${componentName}`);
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
        structure: mapXmlToQuasar(xmlObj.screen?.widgets || xmlObj.widgets || xmlObj),
    };
}