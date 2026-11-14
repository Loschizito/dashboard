// Erro de aplicação com status HTTP e código legível por máquina.
class ErroApi extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

const erroValidacao = (detalhes) =>
  new ErroApi(400, 'PARAMETRO_INVALIDO', 'Um ou mais parâmetros são inválidos.', detalhes);

const erroNaoEncontrado = (mensagem) => new ErroApi(404, 'NAO_ENCONTRADO', mensagem);

const erroRegraNegocio = (mensagem, detalhes) => new ErroApi(422, 'REGRA_DE_NEGOCIO', mensagem, detalhes);

module.exports = { ErroApi, erroValidacao, erroNaoEncontrado, erroRegraNegocio };
