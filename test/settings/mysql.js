const settings = {
  host        : 'localhost',
  port        : 3306,
  user        : 'root',
  password    : 'numtel',
  database    : 'live_select_test',
  serverId    : 347,
  minInterval : 200
};

if(process.env.TRAVIS){
  // Port to use is passed as variable
  settings.port = process.env.TEST_MYSQL_PORT;
}

export default settings;
