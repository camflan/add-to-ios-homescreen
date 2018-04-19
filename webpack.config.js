const path = require('path')

const config = {
    entry: './src/index.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'addtohomescreen.js',
        library: 'addToHomescreen',
        libraryTarget: 'umd',
    },
    module: {
        rules: [
            { test: /\.js$/, use: 'babel-loader' },
            {
                test: /\.?css$/,
                use: [
                    {
                        loader: 'css-loader',
                        options: {
                            url: false,
                            minimize: false,
                            sourceMap: true,
                            importLoaders: 3,
                        },
                    },
                ],
            },
        ],
    },
}

module.exports = config
