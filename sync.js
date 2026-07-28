import axios from "axios";

const API_URL = "https://api.monday.com/v2";

const ORIGEM_BOARD = 18423160692;
const CONTROLE_BOARD = 18423149965;

const client = axios.create({
  baseURL: API_URL,
  headers: {
    Authorization: process.env.MONDAY_TOKEN,
    "Content-Type": "application/json"
  }
});

async function monday(query, variables = {}) {
  const response = await client.post("", {
    query,
    variables
  });

  if (response.data.errors) {
    throw new Error(JSON.stringify(response.data.errors));
  }

  return response.data.data;
}

async function getBoardColumns(boardId) {
  const query = `
    query($boardId: ID!) {
      boards(ids: [$boardId]) {
        columns {
          id
          title
          type
        }
      }
    }
  `;

  const data = await monday(query, { boardId });
  return data.boards[0].columns;
}

function findColumn(columns, title) {
  return columns.find(
    c => c.title.trim().toLowerCase() === title.trim().toLowerCase()
  );
}

async function getPendingItems(statusColumnId) {
  const query = `
    query($boardId: ID!) {
      boards(ids: [$boardId]) {
        items_page(limit: 500) {
          items {
            id
            name
            column_values {
              id
              text
              value
            }
          }
        }
      }
    }
  `;

  const data = await monday(query, {
    boardId: ORIGEM_BOARD
  });

  const items = data.boards[0].items_page.items;

  return items.filter(item => {
    const status = item.column_values.find(
      c => c.id === statusColumnId
    );

    return status?.text === "Pendente";
  });
}

async function updateStatus(itemId, statusColumnId, label) {
  const mutation = `
    mutation(
      $boardId: ID!,
      $itemId: ID!,
      $columnId: String!,
      $value: JSON!
    ) {
      change_column_value(
        board_id: $boardId,
        item_id: $itemId,
        column_id: $columnId,
        value: $value
      ) {
        id
      }
    }
  `;

  await monday(mutation, {
    boardId: ORIGEM_BOARD,
    itemId,
    columnId: statusColumnId,
    value: JSON.stringify({
      label
    })
  });
}

async function updateErrorMessage(
  itemId,
  columnId,
  text
) {
  const mutation = `
    mutation(
      $boardId: ID!,
      $itemId: ID!,
      $columnId: String!,
      $value: String!
    ) {
      change_simple_column_value(
        board_id: $boardId,
        item_id: $itemId,
        column_id: $columnId,
        value: $value
      ) {
        id
      }
    }
  `;

  await monday(mutation, {
    boardId: ORIGEM_BOARD,
    itemId,
    columnId,
    value: text
  });
}

async function findItemByName(boardId, itemName) {
  const query = `
    query($boardId: ID!) {
      boards(ids: [$boardId]) {
        items_page(limit: 500) {
          items {
            id
            name
          }
        }
      }
    }
  `;

  const data = await monday(query, {
    boardId
  });

  return data.boards[0].items_page.items.find(
    item =>
      item.name.trim().toUpperCase() ===
      itemName.trim().toUpperCase()
  );
}

async function updateCustomerData(
  itemId,
  cpfColumnId,
  nomeColumnId,
  retiradaColumnId,
  cpf,
  nome,
  retirada
) {
  const values = {};

  values[cpfColumnId] = cpf;
  values[nomeColumnId] = nome;

  if (retirada) {
    values[retiradaColumnId] = {
      date: retirada
    };
  }

  const mutation = `
    mutation(
      $boardId: ID!,
      $itemId: ID!,
      $values: JSON!
    ) {
      change_multiple_column_values(
        board_id: $boardId,
        item_id: $itemId,
        column_values: $values
      ) {
        id
      }
    }
  `;

  await monday(mutation, {
    boardId: CONTROLE_BOARD,
    itemId,
    values: JSON.stringify(values)
  });
}

async function main() {

  console.log("Iniciando sincronização...");

  const origemColumns =
    await getBoardColumns(ORIGEM_BOARD);

  const controleColumns =
    await getBoardColumns(CONTROLE_BOARD);

  const numeroSerieCol = findColumn(
    origemColumns,
    "Número de Série"
  );

  const cpfOrigemCol = findColumn(
    origemColumns,
    "CPF/CNPJ do Cliente"
  );

  const nomeOrigemCol = findColumn(
    origemColumns,
    "Nome do Cliente"
  );

  const retiradaOrigemCol = findColumn(
    origemColumns,
    "Retirada do Cliente"
  );

  const statusCol = findColumn(
    origemColumns,
    "Status"
  );

  const mensagemErroCol = findColumn(
    origemColumns,
    "Mensagem de Erro"
  );

  const cpfControleCol = findColumn(
    controleColumns,
    "CPF/CNPJ do Cliente"
  );

  const nomeControleCol = findColumn(
    controleColumns,
    "Nome do Cliente"
  );

  const retiradaControleCol = findColumn(
    controleColumns,
    "Retirada do Cliente"
  );

  if (
    !numeroSerieCol ||
    !cpfOrigemCol ||
    !nomeOrigemCol ||
    !retiradaOrigemCol ||
    !statusCol ||
    !mensagemErroCol ||
    !cpfControleCol ||
    !nomeControleCol ||
    !retiradaControleCol
  ) {
    throw new Error(
      "Uma ou mais colunas não foram encontradas."
    );
  }

  const pendentes =
    await getPendingItems(statusCol.id);

  console.log(
    `Pendentes encontrados: ${pendentes.length}`
  );

  for (const item of pendentes) {

    try {

      await updateStatus(
        item.id,
        statusCol.id,
        "Em processamento"
      );

      await updateErrorMessage(
        item.id,
        mensagemErroCol.id,
        ""
      );

      const numeroSerie = item.column_values.find(
        c => c.id === numeroSerieCol.id
      )?.text || "";

      const cpf = item.column_values.find(
        c => c.id === cpfOrigemCol.id
      )?.text || "";

      const nome = item.column_values.find(
        c => c.id === nomeOrigemCol.id
      )?.text || "";

      const retirada = item.column_values.find(
        c => c.id === retiradaOrigemCol.id
      )?.text || "";

      const series = numeroSerie
        .split(/\s+/)
        .map(v => v.trim())
        .filter(Boolean);

      const naoEncontrados = [];

      for (const serie of series) {

        const destino =
          await findItemByName(
            CONTROLE_BOARD,
            serie
          );

        if (!destino) {

          naoEncontrados.push(serie);

          console.log(
            `Série não encontrada: ${serie}`
          );

          continue;
        }

        await updateCustomerData(
          destino.id,
          cpfControleCol.id,
          nomeControleCol.id,
          retiradaControleCol.id,
          cpf,
          nome,
          retirada
        );

        console.log(
          `Atualizado: ${serie}`
        );
      }

      if (naoEncontrados.length > 0) {

        const mensagem =
          `SN não encontrados: ${naoEncontrados.join(", ")}`;

        await updateErrorMessage(
          item.id,
          mensagemErroCol.id,
          mensagem
        );

        await updateStatus(
          item.id,
          statusCol.id,
          "Erro"
        );

        continue;
      }

      await updateStatus(
        item.id,
        statusCol.id,
        "Concluído"
      );

    } catch (erro) {

      console.error(erro);

      try {

        await updateErrorMessage(
          item.id,
          mensagemErroCol.id,
          erro.message
        );

        await updateStatus(
          item.id,
          statusCol.id,
          "Erro"
        );

      } catch {}
    }
  }

  console.log("Fim da sincronização");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
