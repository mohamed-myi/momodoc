"""Tree-sitter language grammar configuration.

Maps language names to their tree-sitter module and the AST node types
that represent top-level definitions worth extracting as chunks.
"""

LANGUAGE_CONFIG: dict[str, dict] = {
    "python": {
        "module": "tree_sitter_python",
        "node_types": {
            "function_definition",
            "class_definition",
            "decorated_definition",
        },
    },
    "javascript": {
        "module": "tree_sitter_javascript",
        "node_types": {
            "function_declaration",
            "class_declaration",
            "method_definition",
            "export_statement",
            "lexical_declaration",
            "variable_declaration",
        },
    },
    "typescript": {
        "module": "tree_sitter_typescript",
        "ts_language": "typescript",
        "node_types": {
            "function_declaration",
            "class_declaration",
            "method_definition",
            "export_statement",
            "lexical_declaration",
            "interface_declaration",
            "type_alias_declaration",
            "enum_declaration",
        },
    },
    "tsx": {
        "module": "tree_sitter_typescript",
        "ts_language": "tsx",
        "node_types": {
            "function_declaration",
            "class_declaration",
            "method_definition",
            "export_statement",
            "lexical_declaration",
            "interface_declaration",
            "type_alias_declaration",
            "enum_declaration",
        },
    },
    "java": {
        "module": "tree_sitter_java",
        "node_types": {
            "class_declaration",
            "interface_declaration",
            "method_declaration",
            "constructor_declaration",
            "enum_declaration",
        },
    },
    "go": {
        "module": "tree_sitter_go",
        "node_types": {
            "function_declaration",
            "method_declaration",
            "type_declaration",
        },
    },
    "rust": {
        "module": "tree_sitter_rust",
        "node_types": {
            "function_item",
            "impl_item",
            "struct_item",
            "enum_item",
            "trait_item",
            "mod_item",
        },
    },
    "c": {
        "module": "tree_sitter_c",
        "node_types": {
            "function_definition",
            "struct_specifier",
            "enum_specifier",
            "type_definition",
        },
    },
    "cpp": {
        "module": "tree_sitter_cpp",
        "node_types": {
            "function_definition",
            "class_specifier",
            "struct_specifier",
            "namespace_definition",
            "template_declaration",
        },
    },
    "ruby": {
        "module": "tree_sitter_ruby",
        "node_types": {
            "method",
            "class",
            "module",
            "singleton_method",
        },
    },
    "php": {
        "module": "tree_sitter_php",
        "php_language": True,
        "node_types": {
            "function_definition",
            "class_declaration",
            "method_declaration",
            "interface_declaration",
            "trait_declaration",
        },
    },
}

# Map from file extension language names (as used in EXTENSION_TO_LANGUAGE)
# to the grammar config key above
LANGUAGE_ALIASES: dict[str, str] = {
    "jsx": "javascript",
    "tsx": "tsx",
}
